import { fetchIssueBody, fetchRepositorySnapshot, searchRepositoryIssues } from '../github/client'
import { type GraphQlTransport, tokenTransport } from '../github/transport'
import { systemColorModes } from '../hooks/use-color-mode'
import type { ExportFile, IssueSource, ViewerPlatform } from './types'

export const transportSource = (transport: GraphQlTransport): IssueSource => ({
  loadRepository: (repository, onUpdate, signal) =>
    fetchRepositorySnapshot(repository, transport, onUpdate, signal),
  loadIssueBody: (repository, number, signal) =>
    fetchIssueBody(repository, number, transport, signal),
  searchIssues: (repository, query, signal) =>
    searchRepositoryIssues(repository, query, transport, signal),
})

const repositoryFromUrl = (): string =>
  new URLSearchParams(window.location.search).get('repo') ?? ''

const updateRepositoryUrl = (repository: string | null): void => {
  const url = new URL(window.location.href)
  if (repository === null) url.searchParams.delete('repo')
  else url.searchParams.set('repo', repository)
  window.history.replaceState(null, '', url)
}

const fileHref = ({ data, encoding, mimeType }: ExportFile): string =>
  encoding === 'base64'
    ? `data:${mimeType};base64,${data}`
    : URL.createObjectURL(new Blob([data], { type: mimeType }))

export const downloadFile = (file: ExportFile): void => {
  const href = fileHref(file)
  const anchor = document.createElement('a')
  anchor.download = file.name
  anchor.href = href
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  if (file.encoding === 'utf8') queueMicrotask(() => URL.revokeObjectURL(href))
}

export const browserPlatform = (): ViewerPlatform => ({
  credentials: { kind: 'token' },
  initialRepository: repositoryFromUrl(),
  colorModes: systemColorModes,
  openSource: (token) => transportSource(tokenTransport(token)),
  rememberRepository: updateRepositoryUrl,
  saveFile: downloadFile,
})
