import type { QualifierTerm } from './search-syntax'
import { type GraphAnalysis, type IssueRecord, issueKey } from './types'

/**
 * Local evaluation of GitHub search qualifiers. Each handler mirrors github.com behavior that was
 * checked against live search results; any qualifier or value form without a handler is left to
 * GitHub search instead of being approximated.
 */

const ISSUE_REFERENCE_PATTERN = /^([\w.-]+\/[\w.-]+)#(\d+)$/
const COMPARISON_PATTERN = /^(>=|<=|>|<)(.+)$/
const RANGE_PATTERN = /^(.+?)\.\.(.+)$/
const COUNT_PATTERN = /^\d+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/
const BOT_SUFFIX_PATTERN = /\[bot\]$/
const APP_PREFIX_PATTERN = /^app\//
const DAY_MILLISECONDS = 86_400_000
const SECOND_MILLISECONDS = 1_000
const CLOSE_REASONS: ReadonlyMap<string, string> = new Map([
  ['completed', 'COMPLETED'],
  ['not planned', 'NOT_PLANNED'],
  ['duplicate', 'DUPLICATE'],
])

export interface RepositoryFacts {
  isPrivate: boolean
  isArchived: boolean
  primaryLanguage: string | null
}

export interface SearchContext {
  analysis: GraphAnalysis
  /** Repositories whose issues were loaded in full, keyed by lower-case `owner/name`. */
  repositories: ReadonlyMap<string, RepositoryFacts>
  viewerLogin: string | null
}

export type IssuePredicate = (issue: IssueRecord) => boolean

type QualifierHandler = (term: QualifierTerm, context: SearchContext) => IssuePredicate | null

/** A half-open interval `[start, end)` that one written number or date covers. */
interface Interval {
  start: number
  end: number
}

type IntervalParser = (value: string) => Interval | null

const lower = (value: string): string => value.toLocaleLowerCase()

const always: IssuePredicate = () => true
const never: IssuePredicate = () => false

const parseCount: IntervalParser = (value) =>
  COUNT_PATTERN.test(value) ? { start: Number(value), end: Number(value) + 1 } : null

/** Dates without a time cover the whole UTC day; timestamps cover one second. */
const parseDate: IntervalParser = (value) => {
  if (DATE_PATTERN.test(value)) {
    const start = Date.parse(`${value}T00:00:00Z`)
    return Number.isNaN(start) ? null : { start, end: start + DAY_MILLISECONDS }
  }
  if (!DATE_TIME_PATTERN.test(value)) return null
  const start = Date.parse(value)
  return Number.isNaN(start) ? null : { start, end: start + SECOND_MILLISECONDS }
}

const comparisons: Readonly<Record<string, (interval: Interval) => (value: number) => boolean>> = {
  '>':
    ({ end }) =>
    (value) =>
      value >= end,
  '>=':
    ({ start }) =>
    (value) =>
      value >= start,
  '<':
    ({ start }) =>
    (value) =>
      value < start,
  '<=':
    ({ end }) =>
    (value) =>
      value < end,
}

const rangeBound = (value: string, parse: IntervalParser, edge: keyof Interval): number | null =>
  value === '*' ? (edge === 'start' ? -Infinity : Infinity) : (parse(value)?.[edge] ?? null)

/** Supports `n`, `>n`, `>=n`, `<n`, `<=n`, `a..b`, `a..*`, and `*..b`. */
const rangePredicate = (
  value: string,
  parse: IntervalParser,
): ((candidate: number) => boolean) | null => {
  const comparison = value.match(COMPARISON_PATTERN)
  if (comparison !== null) {
    const interval = parse(comparison[2] ?? '')
    const compare = comparisons[comparison[1] ?? '']
    return interval === null || compare === undefined ? null : compare(interval)
  }
  const range = value.match(RANGE_PATTERN)
  if (range !== null) {
    const start = rangeBound(range[1] ?? '', parse, 'start')
    const end = rangeBound(range[2] ?? '', parse, 'end')
    return start === null || end === null
      ? null
      : (candidate) => candidate >= start && candidate < end
  }
  const exact = parse(value)
  return exact === null ? null : (candidate) => candidate >= exact.start && candidate < exact.end
}

const numericQualifier =
  (select: (issue: IssueRecord) => number, parse: IntervalParser): QualifierHandler =>
  ({ value }) => {
    const matches = rangePredicate(value, parse)
    return matches === null ? null : (issue) => matches(select(issue))
  }

/** Missing timestamps parse to NaN, which no comparison matches. */
const dateQualifier = (select: (issue: IssueRecord) => string | null): QualifierHandler =>
  numericQualifier((issue) => Date.parse(select(issue) ?? ''), parseDate)

const normalizedLogin = (login: string): string =>
  lower(login).replace(APP_PREFIX_PATTERN, '').replace(BOT_SUFFIX_PATTERN, '')

const loginMatcher = (value: string, context: SearchContext): ((login: string) => boolean) => {
  const wanted = lower(value)
  if (wanted === '@me') {
    const viewer = context.viewerLogin
    return viewer === null ? () => false : (login) => lower(login) === lower(viewer)
  }
  const name = wanted === '@copilot' ? 'copilot' : normalizedLogin(wanted)
  return (login) => normalizedLogin(login) === name
}

const owner = (repository: string): string => lower(repository.split('/')[0] ?? '')

const repositoryFact =
  (context: SearchContext, check: (facts: RepositoryFacts) => boolean): IssuePredicate =>
  (issue) => {
    const facts = context.repositories.get(lower(issue.repository))
    return facts !== undefined && check(facts)
  }

const referencedKey = (value: string): string | null => {
  const match = value.match(ISSUE_REFERENCE_PATTERN)
  return match === null ? null : issueKey(match[1] ?? '', Number(match[2]))
}

const relationQualifier =
  (related: (issue: IssueRecord) => readonly string[]): QualifierHandler =>
  ({ value }) => {
    const key = referencedKey(value)
    return key === null ? null : (issue) => related(issue).includes(key)
  }

const cyclicKeys = (analysis: GraphAnalysis): ReadonlySet<string> => new Set(analysis.cycles.flat())

/** `is:ready`, `is:cyclic`, and `is:external` are Issue Atlas extensions that GitHub does not know. */
const stateChecks = (context: SearchContext): ReadonlyMap<string, IssuePredicate> => {
  const { ready } = context.analysis
  const cyclic = cyclicKeys(context.analysis)
  return new Map<string, IssuePredicate>([
    ['issue', always],
    ['pr', never],
    ['open', (issue) => issue.state === 'OPEN'],
    ['closed', (issue) => issue.state === 'CLOSED'],
    ['locked', (issue) => issue.locked],
    ['unlocked', (issue) => !issue.locked],
    ['public', repositoryFact(context, (facts) => !facts.isPrivate)],
    ['private', repositoryFact(context, (facts) => facts.isPrivate)],
    ['ready', (issue) => issue.state === 'OPEN' && ready.has(issue.key)],
    ['blocked', (issue) => issue.state === 'OPEN' && !ready.has(issue.key)],
    [
      'blocking',
      (issue) => issue.state === 'OPEN' && issue.blocking.some(({ state }) => state === 'OPEN'),
    ],
    ['cyclic', (issue) => cyclic.has(issue.key)],
    ['external', (issue) => issue.isExternal],
  ])
}

const presenceChecks: ReadonlyMap<string, IssuePredicate> = new Map<string, IssuePredicate>([
  ['label', (issue) => issue.labels.length > 0],
  ['milestone', (issue) => issue.milestone !== null],
  ['assignee', (issue) => issue.assignees.length > 0],
  ['type', (issue) => issue.issueType !== null],
  ['parent-issue', (issue) => issue.parent !== null],
  ['sub-issue', (issue) => issue.subIssues.length > 0],
  ['blocked-by', (issue) => issue.blockedBy.length > 0],
  ['blocking', (issue) => issue.blocking.length > 0],
])

const typeQualifier: QualifierHandler = ({ values }) => {
  const wanted = values.map(lower)
  if (wanted.length === 1 && wanted[0] === 'issue') return always
  if (wanted.length === 1 && wanted[0] === 'pr') return never
  return (issue) => issue.issueType !== null && wanted.includes(lower(issue.issueType))
}

const booleanFact =
  (select: (facts: RepositoryFacts) => boolean): QualifierHandler =>
  ({ value }, context) => {
    const wanted = lower(value)
    if (wanted !== 'true' && wanted !== 'false') return null
    return repositoryFact(context, (facts) => select(facts) === (wanted === 'true'))
  }

const handlers: ReadonlyMap<string, QualifierHandler> = new Map<string, QualifierHandler>([
  [
    'is',
    ({ values, value }, context) =>
      values.length === 1 ? (stateChecks(context).get(lower(value)) ?? null) : null,
  ],
  [
    'state',
    ({ value }) => {
      const wanted = lower(value)
      return wanted === 'open' || wanted === 'closed'
        ? (issue) => lower(issue.state) === wanted
        : null
    },
  ],
  ['type', typeQualifier],
  [
    'reason',
    ({ value }) => {
      const reason = CLOSE_REASONS.get(lower(value))
      return reason === undefined ? null : (issue) => issue.stateReason === reason
    },
  ],
  [
    'author',
    ({ value }, context) => {
      const matches = loginMatcher(value, context)
      return (issue) => issue.author !== null && matches(issue.author.login)
    },
  ],
  [
    'assignee',
    ({ value }, context) => {
      if (value === '*') return (issue) => issue.assignees.length > 0
      const matches = loginMatcher(value, context)
      return (issue) => issue.assignees.some(({ login }) => matches(login))
    },
  ],
  [
    'label',
    ({ values }) => {
      const wanted = new Set(values.map(lower))
      return (issue) => issue.labels.some(({ name }) => wanted.has(lower(name)))
    },
  ],
  [
    'milestone',
    ({ value }) => {
      const wanted = lower(value)
      return (issue) => issue.milestone !== null && lower(issue.milestone.title) === wanted
    },
  ],
  ['has', ({ value }) => presenceChecks.get(lower(value)) ?? null],
  [
    'no',
    ({ value }) => {
      const check = presenceChecks.get(lower(value))
      return check === undefined ? null : (issue) => !check(issue)
    },
  ],
  ['blocked-by', relationQualifier((issue) => issue.blockedBy.map(({ key }) => key))],
  ['blocking', relationQualifier((issue) => issue.blocking.map(({ key }) => key))],
  ['parent-issue', relationQualifier((issue) => (issue.parent === null ? [] : [issue.parent]))],
  ['sub-issue', relationQualifier((issue) => issue.subIssues)],
  [
    'repo',
    ({ value }) => {
      const wanted = lower(value)
      return (issue) => lower(issue.repository) === wanted
    },
  ],
  [
    'user',
    ({ value }) =>
      (issue) =>
        owner(issue.repository) === lower(value),
  ],
  [
    'org',
    ({ value }) =>
      (issue) =>
        owner(issue.repository) === lower(value),
  ],
  ['comments', numericQualifier((issue) => issue.commentCount, parseCount)],
  ['reactions', numericQualifier((issue) => issue.reactionCount, parseCount)],
  [
    'interactions',
    numericQualifier((issue) => issue.commentCount + issue.reactionCount, parseCount),
  ],
  ['created', dateQualifier((issue) => issue.createdAt)],
  ['updated', dateQualifier((issue) => issue.updatedAt)],
  ['closed', dateQualifier((issue) => issue.closedAt)],
  ['archived', booleanFact((facts) => facts.isArchived)],
  [
    'language',
    ({ value }, context) =>
      repositoryFact(
        context,
        ({ primaryLanguage }) =>
          primaryLanguage !== null && lower(primaryLanguage) === lower(value),
      ),
  ],
])

/** Returns a predicate when the loaded snapshot answers the qualifier exactly, otherwise null. */
export const localQualifier = (
  term: QualifierTerm,
  context: SearchContext,
): IssuePredicate | null => handlers.get(term.key)?.(term, context) ?? null

/** Issue Atlas text search: title, repository, `#number`, and label names. */
export const localText = (value: string): IssuePredicate => {
  const wanted = lower(value)
  return (issue) =>
    [
      issue.title,
      issue.repository,
      `#${issue.number}`,
      ...issue.labels.map(({ name }) => name),
    ].some((field) => lower(field).includes(wanted))
}
