import { type RefObject, useEffect, useMemo, useState } from 'react'
import {
  filterIssueKeys,
  type IssueSearchPlan,
  planIssueSearch,
  searchContext,
} from '../domain/filters'
import type { GraphAnalysis, RepositorySnapshot } from '../domain/types'
import type { IssueSource } from '../platform/types'
import { type RemoteSearchState, useRemoteSearch } from './use-remote-search'

interface IssueSearchOptions {
  query: string
  snapshot: RepositorySnapshot
  analysis: GraphAnalysis
  /** Only GitHub snapshots can ask GitHub search; the demo blueprint answers locally. */
  source: 'demo' | 'github'
  loading: boolean
  sourceRef: RefObject<IssueSource | null>
}

export interface IssueSearch {
  plan: IssueSearchPlan
  remoteSearch: RemoteSearchState
  visibleKeys: ReadonlySet<string>
}

/** Evaluates a GitHub search query against the snapshot, asking GitHub for what it cannot answer. */
export const useIssueSearch = ({
  query,
  snapshot,
  analysis,
  source,
  loading,
  sourceRef,
}: IssueSearchOptions): IssueSearch => {
  const connected = source === 'github'
  const context = useMemo(() => searchContext(snapshot, analysis), [snapshot, analysis])
  const plan = useMemo(() => planIssueSearch(query, context), [query, context])
  const remoteSearch = useRemoteSearch({
    enabled: connected && !loading,
    connected,
    queries: plan.remoteQueries,
    repository: snapshot.repository,
    sourceRef,
    cacheKey: snapshot.fetchedAt,
  })
  const matchedKeys = useMemo(
    () => (remoteSearch.pending ? null : filterIssueKeys(plan, analysis, remoteSearch.matches)),
    [plan, analysis, remoteSearch],
  )
  // Keep the previous result while GitHub search answers, instead of flashing an empty graph.
  const [settledKeys, setSettledKeys] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (matchedKeys !== null) setSettledKeys(matchedKeys)
  }, [matchedKeys])

  return { plan, remoteSearch, visibleKeys: matchedKeys ?? settledKeys }
}
