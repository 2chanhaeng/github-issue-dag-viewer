import { type SearchNode, serializeOperand, topLevelTerms } from './search-syntax'
import type { IssueStateFilter, ReadinessFilter } from './types'

/**
 * The State, Readiness, and Labels menus and the cross-repository toggle read and rewrite only the
 * query's top-level terms, so the rest of a hand-written query survives menu changes.
 */

export const DEFAULT_QUERY = 'is:issue'

const STATES: ReadonlySet<string> = new Set(['open', 'closed'])
const READINESS: ReadonlySet<string> = new Set(['ready', 'blocked', 'cyclic'])

export interface MenuSelections {
  state: IssueStateFilter
  readiness: ReadinessFilter
  /** Issues with any of these labels; written as one comma-separated `label:` qualifier. */
  labels: ReadonlySet<string>
  showExternal: boolean
}

const qualifierValue = (node: SearchNode, keys: readonly string[]): string | null =>
  node.kind === 'qualifier' && keys.includes(node.key) && node.values.length === 1
    ? node.value.toLocaleLowerCase()
    : null

const stateOf = (node: SearchNode): IssueStateFilter | null => {
  const value = qualifierValue(node, ['state', 'is'])
  return value !== null && STATES.has(value) ? (value as IssueStateFilter) : null
}

const readinessOf = (node: SearchNode): ReadinessFilter | null => {
  const value = qualifierValue(node, ['is'])
  return value !== null && READINESS.has(value) ? (value as ReadinessFilter) : null
}

const labelsOf = (node: SearchNode): readonly string[] =>
  node.kind === 'qualifier' && node.key === 'label' ? node.values : []

const hidesExternal = (node: SearchNode): boolean =>
  node.kind === 'not' && node.minus && qualifierValue(node.child, ['is']) === 'external'

const isMenuTerm = (node: SearchNode): boolean =>
  stateOf(node) !== null ||
  readinessOf(node) !== null ||
  labelsOf(node).length > 0 ||
  hidesExternal(node)

export const menuSelections = (query: string): MenuSelections => {
  const terms = topLevelTerms(query) ?? []
  return {
    state: terms.map(stateOf).findLast((state) => state !== null) ?? 'all',
    readiness: terms.map(readinessOf).findLast((readiness) => readiness !== null) ?? 'all',
    labels: new Set(terms.flatMap(labelsOf)),
    showExternal: !terms.some(hidesExternal),
  }
}

const menuTerms = ({ state, readiness, labels, showExternal }: MenuSelections): string[] =>
  [
    state === 'all' ? '' : `state:${state}`,
    readiness === 'all' ? '' : `is:${readiness}`,
    labels.size === 0
      ? ''
      : `label:${[...labels]
          .toSorted()
          .map((label) => `"${label}"`)
          .join(',')}`,
    showExternal ? '' : '-is:external',
  ].filter(Boolean)

/** A query that does not parse keeps its text, and the menu terms are appended to it. */
export const applyMenuSelections = (query: string, selections: MenuSelections): string => {
  const terms = topLevelTerms(query)
  const kept =
    terms === null
      ? [query.trim()]
      : terms.filter((term) => !isMenuTerm(term)).map(serializeOperand)
  return [...kept, ...menuTerms(selections)].filter(Boolean).join(' ')
}

export const hasActiveQuery = (query: string): boolean => {
  const trimmed = query.trim()
  return trimmed.length > 0 && trimmed !== DEFAULT_QUERY
}
