import type {
  IssueRecord,
  IssueSearchResult,
  LoadProgress,
  RepositorySnapshot,
} from '../domain/types'
import type { ColorMode } from '../hooks/use-color-mode'
import type { ExportFile } from './types'

/** Messages between the Issue Atlas webview and the VS Code extension host. */

export const WEBVIEW_CONFIG_ELEMENT_ID = 'issue-atlas-config'

export interface WebviewConfig {
  initialRepository: string
  colorMode: ColorMode
  credentialDescription: string
}

export interface WebviewState {
  repository: string | null
}

export type WebviewMessage =
  | { type: 'load-repository'; requestId: number; repository: string }
  | { type: 'load-issue-body'; requestId: number; repository: string; number: number }
  | { type: 'search-issues'; requestId: number; repository: string; query: string }
  | { type: 'cancel'; requestId: number }
  | { type: 'save-file'; file: ExportFile }
  | { type: 'repository-changed'; repository: string | null }

export type HostMessage =
  | {
      type: 'repository-page'
      requestId: number
      progress: LoadProgress
      snapshot: Omit<RepositorySnapshot, 'issues'>
      /** Only the issues added since the previous page. */
      issues: IssueRecord[]
    }
  | { type: 'repository-loaded'; requestId: number }
  | { type: 'issue-body'; requestId: number; body: string }
  | { type: 'search-results'; requestId: number; result: IssueSearchResult }
  | { type: 'request-failed'; requestId: number; message: string }

/** GitHub rejects longer search queries well before this bound. */
export const MAXIMUM_SEARCH_QUERY_LENGTH = 4_096

export const EXPORT_FILE_NAME_PATTERN = /^[\w.-]{1,160}\.(json|svg|png)$/
