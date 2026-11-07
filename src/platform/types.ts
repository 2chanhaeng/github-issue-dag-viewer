import type { RepositoryLoadUpdate, RepositoryRef, RepositorySnapshot } from '../domain/types'
import type { ColorModeSource } from '../hooks/use-color-mode'

export interface ExportFile {
  name: string
  mimeType: string
  encoding: 'utf8' | 'base64'
  data: string
}

/** Loads repository data for one connected session. */
export interface IssueSource {
  loadRepository: (
    repository: RepositoryRef,
    onUpdate: (update: RepositoryLoadUpdate) => void,
    signal: AbortSignal,
  ) => Promise<RepositorySnapshot>
  loadIssueBody: (repository: RepositoryRef, number: number, signal: AbortSignal) => Promise<string>
}

/**
 * `token`: the viewer asks for a token and talks to GitHub itself.
 * `host`: the embedding host authenticates, so the viewer never handles credentials.
 */
export type CredentialMode = { kind: 'token' } | { kind: 'host'; description: string }

/** Everything that differs between the hosted web page and an embedding host such as VS Code. */
export interface ViewerPlatform {
  credentials: CredentialMode
  /** A repository to open on start; host platforms connect to it without a dialog. */
  initialRepository: string
  colorModes: ColorModeSource
  openSource: (token: string) => IssueSource
  rememberRepository: (nameWithOwner: string | null) => void
  saveFile: (file: ExportFile) => void
}
