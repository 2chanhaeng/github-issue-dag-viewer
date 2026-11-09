import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteMatches } from '../domain/filters'
import type { IssueSearchResult, RepositoryRef } from '../domain/types'
import type { IssueSource } from '../platform/types'

const QUERY_SEPARATOR = '\n'

type RemoteEntry =
  | { status: 'done'; result: IssueSearchResult }
  | { status: 'failed'; message: string }

interface RemoteCache {
  key: string
  entries: ReadonlyMap<string, RemoteEntry>
}

export interface RemoteSearchState {
  matches: RemoteMatches
  /** True while a connected repository still owes results for a query. */
  pending: boolean
  failures: readonly { query: string; message: string }[]
  truncated: readonly { query: string; total: number; returned: number }[]
  /** Queries that only GitHub can answer while no repository is connected. */
  unavailable: readonly string[]
}

interface RemoteSearchOptions {
  /** False while no live repository is connected or a repository load is still running. */
  enabled: boolean
  /** Whether a live repository is connected at all. */
  connected: boolean
  queries: readonly string[]
  repository: RepositoryRef
  sourceRef: RefObject<IssueSource | null>
  /** Cached results belong to one snapshot and are discarded when this key changes. */
  cacheKey: string
}

const failureMessage = (reason: unknown): string =>
  reason instanceof Error && reason.message.length > 0 ? reason.message : 'GitHub search failed.'

const remoteState = (
  queries: readonly string[],
  entries: ReadonlyMap<string, RemoteEntry>,
  connected: boolean,
): RemoteSearchState => {
  const resolved = queries.flatMap((query) => {
    const entry = entries.get(query)
    return entry === undefined ? [] : [{ query, entry }]
  })
  const results = resolved.flatMap(({ query, entry }) =>
    entry.status === 'done' ? [{ query, result: entry.result }] : [],
  )
  return {
    matches: new Map(results.map(({ query, result }) => [query, new Set(result.keys)])),
    pending: connected && resolved.length < queries.length,
    failures: resolved.flatMap(({ query, entry }) =>
      entry.status === 'failed' ? [{ query, message: entry.message }] : [],
    ),
    truncated: results
      .filter(({ result }) => result.total > result.keys.length)
      .map(({ query, result }) => ({ query, total: result.total, returned: result.keys.length })),
    unavailable: connected ? [] : queries,
  }
}

/** Runs the GitHub searches that a filter query needs and caches each result per snapshot. */
export const useRemoteSearch = ({
  enabled,
  connected,
  queries,
  repository,
  sourceRef,
  cacheKey,
}: RemoteSearchOptions): RemoteSearchState => {
  const [cache, setCache] = useState<RemoteCache>(() => ({ key: cacheKey, entries: new Map() }))
  const entries = useMemo(
    () => (cache.key === cacheKey ? cache.entries : new Map<string, RemoteEntry>()),
    [cache, cacheKey],
  )
  const entriesRef = useRef(entries)
  const queryKey = queries.join(QUERY_SEPARATOR)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    const source = sourceRef.current
    if (!enabled || source === null || queryKey.length === 0) return
    const missing = queryKey
      .split(QUERY_SEPARATOR)
      .filter((query) => !entriesRef.current.has(query))
    if (missing.length === 0) return

    const controller = new AbortController()
    const store = (query: string, entry: RemoteEntry): void => {
      if (controller.signal.aborted) return
      setCache((current) => ({
        key: cacheKey,
        entries: new Map(current.key === cacheKey ? current.entries : []).set(query, entry),
      }))
    }
    for (const query of missing) {
      source.searchIssues(repository, query, controller.signal).then(
        (result) => store(query, { status: 'done', result }),
        (reason: unknown) => store(query, { status: 'failed', message: failureMessage(reason) }),
      )
    }
    return () => controller.abort()
  }, [enabled, queryKey, repository, sourceRef, cacheKey])

  return useMemo(() => remoteState(queries, entries, connected), [queries, entries, connected])
}
