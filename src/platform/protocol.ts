import type { IssueRecord, LoadProgress, RepositorySnapshot } from '../domain/types'
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
  | { type: 'request-failed'; requestId: number; message: string }

export const EXPORT_FILE_NAME_PATTERN = /^[\w.-]{1,160}\.(json|svg|png)$/
