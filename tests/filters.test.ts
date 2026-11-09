import { describe, expect, it } from 'vitest'
import { demoSnapshot } from '../src/demo/demo-data'
import {
  availableLabels,
  filterIssueKeys,
  planIssueSearch,
  type RemoteMatches,
  searchContext,
} from '../src/domain/filters'
import { analyzeGraph } from '../src/domain/graph'
import { issueComparator } from '../src/domain/issue-sort'
import type { SearchContext } from '../src/domain/search-qualifiers'
import type { DependencyRef, IssueRecord } from '../src/domain/types'
import { issueKey } from '../src/domain/types'

const REPOSITORY = 'octo-org/roadmap'
const EXTERNAL = 'other/repo#9'

const actor = (login: string) => ({
  login,
  avatarUrl: `https://github.com/${login}.png`,
  url: `https://github.com/${login}`,
})

const label = (name: string) => ({ name, color: '0969da', description: null })

const dependency = (
  number: number,
  state: DependencyRef['state'] = 'OPEN',
  repository = REPOSITORY,
): DependencyRef => ({
  key: issueKey(repository, number),
  number,
  repository,
  state,
  title: `Issue ${number}`,
  url: `https://github.com/${repository}/issues/${number}`,
})

const issue = (number: number, overrides: Partial<IssueRecord>): IssueRecord => ({
  key: issueKey(REPOSITORY, number),
  id: `issue-${number}`,
  number,
  repository: REPOSITORY,
  title: `Issue ${number}`,
  url: `https://github.com/${REPOSITORY}/issues/${number}`,
  state: 'OPEN',
  stateReason: null,
  body: null,
  author: null,
  assignees: [],
  labels: [],
  milestone: null,
  issueType: null,
  locked: false,
  commentCount: 0,
  reactionCount: 0,
  reactionCounts: {},
  parent: null,
  subIssues: [],
  createdAt: '2026-06-19T00:00:00Z',
  updatedAt: '2026-06-19T00:00:00Z',
  closedAt: null,
  blockedBy: [],
  blocking: [],
  dependencyDataTruncated: false,
  isExternal: false,
  ...overrides,
})

const issues: IssueRecord[] = [
  issue(1, {
    author: actor('monalisa'),
    assignees: [actor('hubot')],
    labels: [label('bug')],
    milestone: { title: 'DrFed 0.2', url: 'https://github.com/octo-org/roadmap/milestone/2' },
    issueType: 'Bug',
    commentCount: 5,
    reactionCount: 2,
    subIssues: [issueKey(REPOSITORY, 3)],
    blocking: [dependency(2)],
    createdAt: '2026-06-19T07:39:44Z',
  }),
  issue(2, {
    author: actor('dependabot'),
    labels: [label('documentation')],
    milestone: { title: 'DrFed 0.1', url: 'https://github.com/octo-org/roadmap/milestone/1' },
    blockedBy: [dependency(1)],
    createdAt: '2026-06-20T00:00:00Z',
  }),
  issue(3, {
    state: 'CLOSED',
    stateReason: 'COMPLETED',
    author: actor('monalisa'),
    labels: [label('bug'), label('documentation')],
    issueType: 'Task',
    locked: true,
    parent: issueKey(REPOSITORY, 1),
    blockedBy: [dependency(9, 'CLOSED', 'other/repo')],
    createdAt: '2026-06-18T23:59:59Z',
    closedAt: '2026-07-01T10:00:00Z',
  }),
  issue(4, {
    state: 'CLOSED',
    stateReason: 'NOT_PLANNED',
    assignees: [actor('octocat')],
    commentCount: 1,
    reactionCount: 3,
    reactionCounts: { THUMBS_UP: 3 },
    createdAt: '2026-06-21T12:00:00Z',
    closedAt: '2026-06-30T00:00:00Z',
  }),
]

const analysis = analyzeGraph(issues)

const context: SearchContext = {
  analysis,
  repositories: new Map([
    [REPOSITORY, { isPrivate: false, isArchived: false, primaryLanguage: 'TypeScript' }],
  ]),
  viewerLogin: 'octocat',
}

const shortKey = (key: string): string => key.replace(`${REPOSITORY}#`, '')

const matches = (query: string, remote: RemoteMatches = new Map()): string[] =>
  [...filterIssueKeys(planIssueSearch(query, context), analysis, remote)].map(shortKey).toSorted()

const ALL = ['1', '2', '3', '4', EXTERNAL]
const LOADED = ['1', '2', '3', '4']

describe('local GitHub qualifiers', () => {
  it.each([
    ['milestone:"DrFed 0.2"', ['1']],
    ['milestone:"drfed 0.2"', ['1']],
    ['milestone:DrFed', []],
    ['milestone:"DrFed 0.2","DrFed 0.1"', []],
    ['milestone:"DrFed 0.2" milestone:"DrFed 0.1"', []],
    ['-milestone:"DrFed 0.2"', ['2', '3', '4', EXTERNAL]],
    ['no:milestone', ['3', '4', EXTERNAL]],
    ['has:milestone', ['1', '2']],
  ])('matches milestones: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['label:bug', ['1', '3']],
    ['label:BUG,documentation', ['1', '2', '3']],
    ['label:"bug","documentation"', ['1', '2', '3']],
    ['label:bug label:documentation', ['3']],
    ['-label:bug,documentation', ['4', EXTERNAL]],
  ])('matches labels with comma OR and repeated AND: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['state:open', ['1', '2']],
    ['is:closed', ['3', '4', EXTERNAL]],
    ['is:open OR is:closed', ALL],
    ['is:open is:closed', []],
    ['reason:completed', ['3']],
    ['reason:"not planned"', ['4']],
    ['is:locked', ['3']],
    ['is:unlocked', ['1', '2', '4', EXTERNAL]],
    ['is:issue', ALL],
    ['type:issue', ALL],
    ['is:pr', []],
    ['type:bug', ['1']],
    ['type:Bug,Task', ['1', '3']],
    ['no:type', ['2', '4', EXTERNAL]],
  ])('matches state, close reason, lock, and type: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['author:MONALISA', ['1', '3']],
    ['author:monali', []],
    ['author:app/dependabot', ['2']],
    ['author:dependabot[bot]', ['2']],
    ['author:monalisa,dependabot', []],
    ['assignee:@me', ['4']],
    ['assignee:*', ['1', '4']],
    ['-assignee:*', ['2', '3', EXTERNAL]],
    ['no:assignee', ['2', '3', EXTERNAL]],
  ])('matches people: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['is:ready', ['1']],
    ['is:blocked', ['2']],
    ['is:blocking', ['1']],
    ['is:cyclic', []],
    ['is:external', [EXTERNAL]],
    ['-is:external', LOADED],
    ['has:blocked-by', ['2', '3']],
    ['no:blocking', ['2', '3', '4', EXTERNAL]],
    ['blocked-by:octo-org/roadmap#1', ['2']],
    ['blocked-by:other/repo#9', ['3']],
    ['blocking:octo-org/roadmap#2', ['1']],
    ['has:parent-issue', ['3']],
    ['has:sub-issue', ['1']],
    ['parent-issue:octo-org/roadmap#1', ['3']],
    ['sub-issue:octo-org/roadmap#3', ['1']],
  ])('matches dependencies and sub-issues: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['comments:>3', ['1']],
    ['comments:1..5', ['1', '4']],
    ['reactions:>=3', ['4']],
    ['interactions:>4', ['1']],
    ['interactions:*..4', ['2', '3', '4', EXTERNAL]],
    ['created:2026-06-19', ['1']],
    ['created:<=2026-06-19', ['1', '3']],
    ['created:>2026-06-19', ['2', '4']],
    ['created:2026-06-19..*', ['1', '2', '4']],
    ['created:<2026-06-19T07:40:00Z', ['1', '3']],
    ['created:<2026-06-19T16:39:00+09:00', ['3']],
    ['closed:>=2026-07-01', ['3']],
    ['updated:<2026-06-20', LOADED],
  ])('matches counts and dates: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it.each([
    ['repo:OCTO-ORG/roadmap', LOADED],
    ['user:other', [EXTERNAL]],
    ['org:octo-org', LOADED],
    ['language:typescript', LOADED],
    ['archived:false', LOADED],
    ['is:public', LOADED],
    ['is:private', []],
  ])('matches repository scope and facts: %s', (query, expected) => {
    expect(matches(query)).toEqual(expected)
  })

  it('ignores -no: like GitHub instead of excluding issues without the metadata', () => {
    expect(matches('-no:milestone')).toEqual(ALL)
    expect(planIssueSearch('-no:project', context).remoteQueries).toEqual([])
  })

  it('combines AND, OR, NOT, and parentheses', () => {
    expect(matches('(label:bug OR milestone:"DrFed 0.1") is:open')).toEqual(['1', '2'])
    expect(matches('is:closed is:open OR milestone:"DrFed 0.2"')).toEqual(['1'])
    expect(matches('-label:bug -is:external')).toEqual(['2', '4'])
    expect(matches('NOT "Issue 1" -is:external')).toEqual(['2', '3', '4'])
  })

  it('matches nothing when NOT precedes a qualifier or a group, as GitHub does', () => {
    for (const query of ['is:open NOT label:bug', 'is:open OR NOT label:bug', 'NOT (a OR b)']) {
      expect(planIssueSearch(query, context).error).toMatch(/NOT only to one word or phrase/)
      expect(matches(query)).toEqual([])
    }
    expect(planIssueSearch('NOT (graph)', context).error).toBeNull()
  })

  it('treats a query that does not parse as matching nothing', () => {
    const plan = planIssueSearch('(label:bug', context)

    expect(plan.error).toBe('Close every opening parenthesis.')
    expect(matches('(label:bug')).toEqual([])
  })
})

describe('GitHub search delegation', () => {
  it('asks GitHub for qualifiers that the snapshot cannot answer', () => {
    const plan = planIssueSearch('is:open mentions:octocat', context)
    const remote = new Map([['mentions:octocat', new Set([issueKey(REPOSITORY, 2)])]])

    expect(plan.remoteQueries).toEqual(['mentions:octocat'])
    expect(matches('is:open mentions:octocat', remote)).toEqual(['2'])
    expect(matches('is:open mentions:octocat')).toEqual([])
  })

  it('answers sibling GitHub-only terms with one grouped search', () => {
    expect(planIssueSearch('mentions:a commenter:b is:open', context).remoteQueries).toEqual([
      'mentions:a commenter:b',
    ])
    expect(
      planIssueSearch('label:bug (mentions:a OR linked:pr OR is:ready)', context).remoteQueries,
    ).toEqual(['(mentions:a OR linked:pr)'])
  })

  it('complements excluded GitHub-only terms locally', () => {
    const remote = new Map([['mentions:a', new Set([issueKey(REPOSITORY, 1)])]])

    expect(planIssueSearch('-mentions:a', context).remoteQueries).toEqual(['mentions:a'])
    expect(matches('-mentions:a', remote)).toEqual(['2', '3', '4', EXTERNAL])
  })

  it('sends text to GitHub only when in: chooses the searched fields', () => {
    expect(planIssueSearch('graph', context).remoteQueries).toEqual([])
    expect(planIssueSearch('graph in:body', context).remoteQueries).toEqual(['graph in:body'])
    expect(planIssueSearch('graph OR label:bug in:title,body', context).remoteQueries).toEqual([
      'graph in:title,body',
    ])
  })

  it('leaves unknown qualifiers and unverified values to GitHub', () => {
    expect(planIssueSearch('linked:pr', context).remoteQueries).toEqual(['linked:pr'])
    expect(planIssueSearch('reason:reopened', context).remoteQueries).toEqual(['reason:reopened'])
    expect(planIssueSearch('blocked-by:1', context).remoteQueries).toEqual(['blocked-by:1'])
    expect(planIssueSearch('has:project', context).remoteQueries).toEqual(['has:project'])
  })
})

describe('sort qualifiers', () => {
  it('parses sort without filtering and orders the issue list', () => {
    const plan = planIssueSearch('sort:comments', context)
    const ordered = [...analysis.nodes.values()]
      .toSorted(issueComparator(plan.sort, analysis))
      .map(({ key }) => shortKey(key))

    expect(plan.sort).toEqual({ field: 'comments', direction: 'desc' })
    expect(matches('sort:comments')).toEqual(ALL)
    expect(ordered).toEqual(['1', '4', '2', '3', EXTERNAL])
  })

  it.each([
    ['sort:created-asc', { field: 'created', direction: 'asc' }],
    ['sort:reactions-+1', { field: { reaction: 'THUMBS_UP' }, direction: 'desc' }],
    ['sort:reactions--1-asc', { field: { reaction: 'THUMBS_DOWN' }, direction: 'asc' }],
    ['sort:relevance', null],
    ['sort:unknown', null],
  ])('reads %s', (query, expected) => {
    expect(planIssueSearch(query, context).sort).toEqual(expected)
  })
})

describe('demo search', () => {
  const demoAnalysis = analyzeGraph(demoSnapshot.issues)
  const demoContext = searchContext(demoSnapshot, demoAnalysis)
  const demoMatches = (query: string): string[] =>
    [...filterIssueKeys(planIssueSearch(query, demoContext), demoAnalysis, new Map())].toSorted()

  it('searches titles, numbers, repositories, and labels', () => {
    expect(demoMatches('critical path')).toEqual(['ccheney/github-issue-dag-viewer#16'])
    expect(demoMatches('"critical path"')).toEqual(['ccheney/github-issue-dag-viewer#16'])
  })

  it('combines state and label qualifiers', () => {
    expect(demoMatches('is:issue state:closed label:"area:docs"')).toEqual([
      'ccheney/github-issue-dag-viewer#31',
      'ccheney/github-issue-dag-viewer#39',
    ])
  })

  it('returns a stable sorted label catalog', () => {
    expect(availableLabels(demoAnalysis)).toEqual([
      'area:api',
      'area:delivery',
      'area:docs',
      'area:foundation',
      'area:graph',
      'area:performance',
      'area:quality',
      'area:security',
      'area:ui',
    ])
  })
})
