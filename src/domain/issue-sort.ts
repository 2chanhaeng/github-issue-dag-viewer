import type { GraphAnalysis, IssueRecord } from './types'

/** GitHub `sort:` values for issues. Without a suffix every order is descending, as on GitHub. */

const SORT_PATTERN = /^(created|updated|comments|reactions|interactions)(?:-(asc|desc))?$/
const REACTION_SORT_PATTERN =
  /^reactions-(\+1|-1|smile|tada|heart|thinking_face|rocket|eyes)(?:-(asc|desc))?$/
const REACTION_CONTENT: ReadonlyMap<string, string> = new Map([
  ['+1', 'THUMBS_UP'],
  ['-1', 'THUMBS_DOWN'],
  ['smile', 'LAUGH'],
  ['tada', 'HOORAY'],
  ['heart', 'HEART'],
  ['thinking_face', 'CONFUSED'],
  ['rocket', 'ROCKET'],
  ['eyes', 'EYES'],
])

export type IssueSortField = 'created' | 'updated' | 'comments' | 'reactions' | 'interactions'

export interface IssueSort {
  /** A field, or a GitHub `ReactionContent` name such as `THUMBS_UP`. */
  field: IssueSortField | { reaction: string }
  direction: 'asc' | 'desc'
}

type IssueComparator = (left: IssueRecord, right: IssueRecord) => number

/** Returns null for `sort:relevance` and unknown values, which keep the default order. */
export const parseIssueSort = (value: string): IssueSort | null => {
  const normalized = value.toLocaleLowerCase()
  const reaction = normalized.match(REACTION_SORT_PATTERN)
  const content = REACTION_CONTENT.get(reaction?.[1] ?? '')
  if (reaction !== null && content !== undefined) {
    return { field: { reaction: content }, direction: reaction[2] === 'asc' ? 'asc' : 'desc' }
  }
  const field = normalized.match(SORT_PATTERN)
  if (field === null) return null
  return {
    field: (field[1] ?? 'created') as IssueSortField,
    direction: field[2] === 'asc' ? 'asc' : 'desc',
  }
}

const sortValue = (issue: IssueRecord, field: IssueSort['field']): number => {
  if (typeof field === 'object') return issue.reactionCounts[field.reaction] ?? 0
  switch (field) {
    case 'created':
      return Date.parse(issue.createdAt)
    case 'updated':
      return Date.parse(issue.updatedAt)
    case 'comments':
      return issue.commentCount
    case 'reactions':
      return issue.reactionCount
    case 'interactions':
      return issue.commentCount + issue.reactionCount
  }
}

/** Ready issues first, then by number and repository. */
const defaultComparator =
  (analysis: GraphAnalysis): IssueComparator =>
  (left, right) =>
    Number(analysis.ready.has(right.key)) - Number(analysis.ready.has(left.key)) ||
    left.number - right.number ||
    left.repository.localeCompare(right.repository)

/** Cross-repository nodes lack the sorted metadata, so they always follow loaded issues. */
export const issueComparator = (
  sort: IssueSort | null,
  analysis: GraphAnalysis,
): IssueComparator => {
  const fallback = defaultComparator(analysis)
  if (sort === null) return fallback
  const sign = sort.direction === 'asc' ? 1 : -1
  return (left, right) => {
    const external = Number(left.isExternal) - Number(right.isExternal)
    const leftValue = sortValue(left, sort.field)
    const rightValue = sortValue(right, sort.field)
    const difference =
      Number.isNaN(leftValue) || Number.isNaN(rightValue) ? 0 : (leftValue - rightValue) * sign
    return external || difference || fallback(left, right)
  }
}
