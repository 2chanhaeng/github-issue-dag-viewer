import { type IssueSort, parseIssueSort } from './issue-sort'
import {
  type IssuePredicate,
  localQualifier,
  localText,
  type SearchContext,
} from './search-qualifiers'
import { parseSearch, type QualifierTerm, type SearchNode, serializeOperand } from './search-syntax'
import type { GraphAnalysis, RepositorySnapshot } from './types'

export type { SearchContext } from './search-qualifiers'

/**
 * `in:` and `sort:` modify the whole query instead of matching issues. GitHub applies `in:` to every
 * text term, so text is searched locally only when the query has no `in:` qualifier.
 */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['in', 'sort'])
const NOT_OPERAND_ERROR =
  'GitHub applies NOT only to one word or phrase and matches nothing otherwise. Exclude qualifiers with a minus, such as -label:bug.'

/** Issue keys that GitHub search matched, keyed by the query from `IssueSearchPlan.remoteQueries`. */
export type RemoteMatches = ReadonlyMap<string, ReadonlySet<string>>

export interface IssueSearchPlan {
  error: string | null
  /** GitHub search queries, without the repository scope, whose results the plan needs. */
  remoteQueries: readonly string[]
  sort: IssueSort | null
  /** Builds the issue predicate; a remote query without results matches no issues. */
  matcher: (remote: RemoteMatches) => IssuePredicate
}

type RemotePlan = { kind: 'remote'; node: SearchNode; query: string }

type PlanNode =
  | { kind: 'local'; predicate: IssuePredicate }
  | RemotePlan
  | { kind: 'not'; child: PlanNode }
  | { kind: 'and' | 'or'; children: readonly PlanNode[] }

const always: IssuePredicate = () => true
const never: IssuePredicate = () => false

/** GitHub returns no results at all when `NOT` precedes a qualifier or a group. */
const hasUnsupportedNot = (node: SearchNode): boolean => {
  if (node.kind === 'not') {
    return (!node.minus && node.child.kind !== 'text') || hasUnsupportedNot(node.child)
  }
  return node.kind === 'and' || node.kind === 'or' ? node.children.some(hasUnsupportedNot) : false
}

const isModifier = (node: SearchNode): node is QualifierTerm =>
  node.kind === 'qualifier' && MODIFIER_KEYS.has(node.key)

const collectModifiers = (node: SearchNode): QualifierTerm[] => {
  if (isModifier(node)) return [node]
  if (node.kind === 'not') return collectModifiers(node.child)
  if (node.kind === 'and' || node.kind === 'or') return node.children.flatMap(collectModifiers)
  return []
}

const withoutModifiers = (node: SearchNode): SearchNode | null => {
  if (isModifier(node)) return null
  if (node.kind === 'not') {
    const child = withoutModifiers(node.child)
    return child === null ? null : { ...node, child }
  }
  if (node.kind !== 'and' && node.kind !== 'or') return node
  const children = node.children.map(withoutModifiers).filter((child) => child !== null)
  if (children.length <= 1) return children[0] ?? null
  return { kind: node.kind, children }
}

const remotePlan = (node: SearchNode, scopes: readonly string[]): RemotePlan => ({
  kind: 'remote',
  node,
  query: [serializeOperand(node), ...scopes].join(' '),
})

/** Joins sibling GitHub-only terms so that one search answers all of them. */
const planGroup = (
  kind: 'and' | 'or',
  plans: readonly PlanNode[],
  scopes: readonly string[],
): PlanNode => {
  const remote = plans.filter((plan): plan is RemotePlan => plan.kind === 'remote')
  if (remote.length < 2) return { kind, children: plans }
  const merged = remotePlan({ kind, children: remote.map(({ node }) => node) }, scopes)
  const local = plans.filter((plan) => plan.kind !== 'remote')
  return local.length === 0 ? merged : { kind, children: [...local, merged] }
}

/** GitHub ignores `-no:…` instead of excluding issues that lack the metadata. */
const ignoresExclusion = (node: Extract<SearchNode, { kind: 'not' }>): boolean =>
  node.minus && node.child.kind === 'qualifier' && node.child.key === 'no'

const planNode = (
  node: SearchNode,
  context: SearchContext,
  scopes: readonly string[],
): PlanNode => {
  switch (node.kind) {
    case 'qualifier': {
      const predicate = localQualifier(node, context)
      return predicate === null ? remotePlan(node, scopes) : { kind: 'local', predicate }
    }
    case 'text':
      return scopes.length > 0
        ? remotePlan(node, scopes)
        : { kind: 'local', predicate: localText(node.value) }
    case 'not':
      return ignoresExclusion(node)
        ? { kind: 'local', predicate: always }
        : { kind: 'not', child: planNode(node.child, context, scopes) }
    case 'and':
    case 'or':
      return planGroup(
        node.kind,
        node.children.map((child) => planNode(child, context, scopes)),
        scopes,
      )
  }
}

const remoteQueriesOf = (plan: PlanNode): string[] => {
  switch (plan.kind) {
    case 'local':
      return []
    case 'remote':
      return [plan.query]
    case 'not':
      return remoteQueriesOf(plan.child)
    case 'and':
    case 'or':
      return plan.children.flatMap(remoteQueriesOf)
  }
}

const compile = (plan: PlanNode, remote: RemoteMatches): IssuePredicate => {
  switch (plan.kind) {
    case 'local':
      return plan.predicate
    case 'remote': {
      const keys = remote.get(plan.query)
      return keys === undefined ? never : (issue) => keys.has(issue.key)
    }
    case 'not': {
      const child = compile(plan.child, remote)
      return (issue) => !child(issue)
    }
    case 'and': {
      const children = plan.children.map((child) => compile(child, remote))
      return (issue) => children.every((matches) => matches(issue))
    }
    case 'or': {
      const children = plan.children.map((child) => compile(child, remote))
      return (issue) => children.some((matches) => matches(issue))
    }
  }
}

const constantPlan = (
  matches: IssuePredicate,
  error: string | null,
  sort: IssueSort | null,
): IssueSearchPlan => ({ error, remoteQueries: [], sort, matcher: () => matches })

/** Parses a GitHub issue search query and decides which parts GitHub search must answer. */
export const planIssueSearch = (query: string, context: SearchContext): IssueSearchPlan => {
  const parsed = parseSearch(query)
  if (!parsed.ok) return constantPlan(never, parsed.error, null)
  if (parsed.node === null) return constantPlan(always, null, null)
  if (hasUnsupportedNot(parsed.node)) return constantPlan(never, NOT_OPERAND_ERROR, null)

  const modifiers = collectModifiers(parsed.node)
  const scopes = modifiers.filter(({ key }) => key === 'in').map(({ raw }) => raw)
  const sortTerm = modifiers.findLast(({ key }) => key === 'sort')
  const sort = sortTerm === undefined ? null : parseIssueSort(sortTerm.value)
  const node = withoutModifiers(parsed.node)
  if (node === null) return constantPlan(always, null, sort)

  const plan = planNode(node, context, scopes)
  return {
    error: null,
    remoteQueries: [...new Set(remoteQueriesOf(plan))],
    sort,
    matcher: (remote) => compile(plan, remote),
  }
}

export const filterIssueKeys = (
  plan: IssueSearchPlan,
  analysis: GraphAnalysis,
  remote: RemoteMatches,
): Set<string> => {
  const matches = plan.matcher(remote)
  return new Set([...analysis.nodes.values()].filter(matches).map(({ key }) => key))
}

/** Repository facts are known only for the loaded repository; other nodes are partial. */
export const searchContext = (
  snapshot: RepositorySnapshot,
  analysis: GraphAnalysis,
): SearchContext => ({
  analysis,
  repositories: new Map([
    [
      snapshot.repository.nameWithOwner.toLocaleLowerCase(),
      {
        isPrivate: snapshot.isPrivate,
        isArchived: snapshot.isArchived,
        primaryLanguage: snapshot.primaryLanguage,
      },
    ],
  ]),
  viewerLogin: snapshot.viewerLogin,
})

export const availableLabels = (analysis: GraphAnalysis): string[] =>
  [
    ...new Set(
      [...analysis.nodes.values()].flatMap(({ labels }) => labels.map(({ name }) => name)),
    ),
  ].toSorted((left, right) => left.localeCompare(right))
