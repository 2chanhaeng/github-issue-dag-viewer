import type { ZodType } from 'zod'
import { parseSearch, serializeSearch } from '../domain/search-syntax'
import type {
  IssueSearchResult,
  RepositoryLoadUpdate,
  RepositoryRef,
  RepositorySnapshot,
} from '../domain/types'
import { type DependencyRef, type IssueRecord, issueKey } from '../domain/types'
import {
  type IssueSearchResponse,
  issueDetailsSchema,
  issueSearchSchema,
  type RepositoryPageResponse,
  repositoryPageSchema,
} from './schemas'
import { GitHubGraphQlError, type GraphQlTransport } from './transport'

export { GitHubGraphQlError, type GraphQlTransport, tokenTransport } from './transport'

const REPOSITORY_PAGE_QUERY = `
  query RepositoryIssueDependencies($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      url
      description
      isPrivate
      isArchived
      primaryLanguage { name }
      issues(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id number title url state stateReason createdAt updatedAt closedAt
          author { login avatarUrl url }
          assignees(first: 20) { nodes { login avatarUrl url } }
          labels(first: 50) { nodes { name color description } }
          milestone { title url }
          issueType { name }
          locked
          comments { totalCount }
          reactions { totalCount }
          reactionGroups { content reactors { totalCount } }
          parent { number repository { nameWithOwner } }
          subIssues(first: 100) { nodes { number repository { nameWithOwner } } }
          blockedBy(first: 100) {
            totalCount
            nodes { number state title url repository { nameWithOwner } }
          }
          blocking(first: 100) {
            totalCount
            nodes { number state title url repository { nameWithOwner } }
          }
        }
      }
    }
    viewer { login }
    rateLimit { cost remaining resetAt }
  }
`

/** `ISSUE_ADVANCED` accepts `AND`, `OR`, and parentheses. */
const ISSUE_SEARCH_QUERY = `
  query IssueSearch($query: String!, $cursor: String) {
    search(query: $query, type: ISSUE_ADVANCED, first: 100, after: $cursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on Issue { number repository { nameWithOwner } } }
    }
  }
`

/** GitHub search returns at most this many results for one query. */
const SEARCH_RESULT_LIMIT = 1_000

const ISSUE_DETAILS_QUERY = `
  query IssueDetails($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) { number body updatedAt }
    }
    rateLimit { cost remaining resetAt }
  }
`

const request = async <T>(
  transport: GraphQlTransport,
  query: string,
  variables: Readonly<Record<string, unknown>>,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const envelope = await transport(query, variables, signal)
  if (envelope.data === undefined || (envelope.errors?.length ?? 0) > 0) {
    throw new GitHubGraphQlError('GitHub rejected the GraphQL request.')
  }

  const result = schema.safeParse(envelope.data)
  if (!result.success) {
    throw new GitHubGraphQlError('GitHub returned an unexpected issue dependency response.')
  }
  return result.data
}

const dependencyRef = (dependency: {
  number: number
  repository: { nameWithOwner: string }
  state: 'OPEN' | 'CLOSED'
  title: string
  url: string
}): DependencyRef => ({
  ...dependency,
  repository: dependency.repository.nameWithOwner,
  key: issueKey(dependency.repository.nameWithOwner, dependency.number),
})

const referenceKey = (reference: { number: number; repository: { nameWithOwner: string } }) =>
  issueKey(reference.repository.nameWithOwner, reference.number)

const issueRecord = (
  repository: string,
  {
    issueType,
    comments,
    reactions,
    reactionGroups,
    parent,
    subIssues,
    ...issue
  }: NonNullable<RepositoryPageResponse['repository']>['issues']['nodes'][number],
): IssueRecord => ({
  ...issue,
  key: issueKey(repository, issue.number),
  repository,
  body: null,
  assignees: issue.assignees.nodes,
  labels: issue.labels.nodes,
  issueType: issueType?.name ?? null,
  commentCount: comments.totalCount,
  reactionCount: reactions.totalCount,
  reactionCounts: Object.fromEntries(
    (reactionGroups ?? []).map(({ content, reactors }) => [content, reactors.totalCount]),
  ),
  parent: parent === null ? null : referenceKey(parent),
  subIssues: subIssues.nodes.map(referenceKey),
  blockedBy: issue.blockedBy.nodes.map(dependencyRef),
  blocking: issue.blocking.nodes.map(dependencyRef),
  dependencyDataTruncated:
    issue.blockedBy.totalCount > issue.blockedBy.nodes.length ||
    issue.blocking.totalCount > issue.blocking.nodes.length,
  isExternal: false,
})

export const fetchRepositorySnapshot = async (
  repository: RepositoryRef,
  transport: GraphQlTransport,
  onUpdate: (update: RepositoryLoadUpdate) => void,
  signal?: AbortSignal,
): Promise<RepositorySnapshot> => {
  const issues: IssueRecord[] = []
  const fetchedAt = new Date().toISOString()
  let cursor: string | null = null
  let hasNextPage = true
  let snapshot: RepositorySnapshot | null = null

  while (hasNextPage) {
    const page: RepositoryPageResponse = await request(
      transport,
      REPOSITORY_PAGE_QUERY,
      { owner: repository.owner, name: repository.name, cursor },
      repositoryPageSchema,
      signal,
    )
    if (page.repository === null) {
      throw new GitHubGraphQlError('Repository not found or the token cannot access it.')
    }

    const { issues: connection, ...repositoryData } = page.repository
    issues.push(
      ...connection.nodes.map((issue) => issueRecord(repositoryData.nameWithOwner, issue)),
    )
    snapshot = {
      repository: {
        owner: repository.owner,
        name: repository.name,
        nameWithOwner: repositoryData.nameWithOwner,
        url: repositoryData.url,
      },
      description: repositoryData.description,
      isPrivate: repositoryData.isPrivate,
      isArchived: repositoryData.isArchived,
      primaryLanguage: repositoryData.primaryLanguage?.name ?? null,
      viewerLogin: page.viewer?.login ?? null,
      issues: [...issues],
      fetchedAt,
      rateLimit: page.rateLimit,
    }
    onUpdate({
      progress: { loaded: issues.length, total: connection.totalCount },
      snapshot,
    })
    const nextCursor = connection.pageInfo.endCursor
    hasNextPage = connection.pageInfo.hasNextPage
    if (hasNextPage && (nextCursor === null || nextCursor === cursor)) {
      throw new GitHubGraphQlError('GitHub returned invalid pagination metadata.')
    }
    cursor = nextCursor
  }

  if (snapshot === null) {
    throw new GitHubGraphQlError('GitHub returned no repository data.')
  }
  return snapshot
}

export const fetchIssueBody = async (
  repository: RepositoryRef,
  number: number,
  transport: GraphQlTransport,
  signal?: AbortSignal,
): Promise<string> => {
  const result = await request(
    transport,
    ISSUE_DETAILS_QUERY,
    { owner: repository.owner, name: repository.name, number },
    issueDetailsSchema,
    signal,
  )
  const issue = result.repository?.issue
  if (issue === null || issue === undefined) {
    throw new GitHubGraphQlError(`Issue #${number} is no longer available.`)
  }
  return issue.body
}

const searchPageKeys = (page: IssueSearchResponse): string[] =>
  page.search.nodes.flatMap((node) =>
    node?.number === undefined || node.repository === undefined
      ? []
      : [issueKey(node.repository.nameWithOwner, node.number)],
  )

/** Re-serializes the query inside parentheses so that an `OR` cannot widen the repository scope. */
const scopedSearchQuery = (repository: RepositoryRef, query: string): string => {
  const parsed = parseSearch(query)
  if (!parsed.ok) throw new GitHubGraphQlError(parsed.error)
  const scope = `repo:${repository.nameWithOwner} is:issue`
  return parsed.node === null ? scope : `${scope} (${serializeSearch(parsed.node)})`
}

/** Runs a GitHub issue search inside one repository, keeping up to GitHub's 1,000 results. */
export const searchRepositoryIssues = async (
  repository: RepositoryRef,
  query: string,
  transport: GraphQlTransport,
  signal?: AbortSignal,
): Promise<IssueSearchResult> => {
  const scoped = scopedSearchQuery(repository, query)
  const keys: string[] = []
  let cursor: string | null = null
  let total = 0
  let hasNextPage = true

  while (hasNextPage && keys.length < SEARCH_RESULT_LIMIT) {
    const page: IssueSearchResponse = await request(
      transport,
      ISSUE_SEARCH_QUERY,
      { query: scoped, cursor },
      issueSearchSchema,
      signal,
    )
    keys.push(...searchPageKeys(page))
    total = page.search.issueCount
    const nextCursor = page.search.pageInfo.endCursor
    hasNextPage = page.search.pageInfo.hasNextPage && nextCursor !== null && nextCursor !== cursor
    cursor = nextCursor
  }
  return { keys, total }
}
