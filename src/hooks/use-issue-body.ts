import { type RefObject, useEffect, useState } from 'react'
import type { IssueRecord, RepositoryRef } from '../domain/types'
import type { IssueSource } from '../platform/types'

interface LazyIssueBodyOptions {
  /** False while no live repository is connected or a repository load is still running. */
  enabled: boolean
  issue: IssueRecord | null
  repository: RepositoryRef
  sourceRef: RefObject<IssueSource | null>
  onBody: (key: string, body: string) => void
  onError: (message: string) => void
}

/** Loads the selected local issue's body once and reports whether that request is in flight. */
export const useLazyIssueBody = ({
  enabled,
  issue,
  repository,
  sourceRef,
  onBody,
  onError,
}: LazyIssueBodyOptions): boolean => {
  const [bodyLoading, setBodyLoading] = useState(false)

  useEffect(() => {
    const source = sourceRef.current
    if (!enabled || issue === null || issue.isExternal || issue.body !== null || source === null) {
      return
    }

    const controller = new AbortController()
    setBodyLoading(true)
    source
      .loadIssueBody(repository, issue.number, controller.signal)
      .then((body) => onBody(issue.key, body))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          onError(reason instanceof Error ? reason.message : 'Unable to load issue.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setBodyLoading(false)
      })
    return () => controller.abort()
  }, [enabled, issue, repository, sourceRef, onBody, onError])

  return bodyLoading
}
