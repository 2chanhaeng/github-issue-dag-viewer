import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import * as vscode from 'vscode'
import {
  fetchIssueBody,
  fetchRepositorySnapshot,
  searchRepositoryIssues,
} from '../../src/github/client'
import { parseRepositoryInput } from '../../src/github/parse-repository'
import type { GraphQlTransport } from '../../src/github/transport'
import type { ColorMode } from '../../src/hooks/use-color-mode'
import type { HostMessage, WebviewMessage } from '../../src/platform/protocol'
import type { ExportFile } from '../../src/platform/types'
import { parseWebviewMessage } from './messages'
import { repositoryPageMessages } from './repository-stream'
import { WEBVIEW_DIRECTORY, WEBVIEW_SCRIPT, WEBVIEW_STYLESHEET } from './webview-assets'
import { renderWebviewHtml } from './webview-html'

export const GRAPH_VIEW_TYPE = 'issueAtlas.graph'

export interface PanelEnvironment {
  extensionUri: vscode.Uri
  /** Creates a transport for one repository session, reading the current credential settings. */
  createTransport: () => GraphQlTransport
  credentialDescription: () => string
}

export interface GraphPanel {
  repository: () => string | null
  reveal: () => void
}

export const panelTitle = (repository: string | null): string =>
  repository === null ? 'Issue Atlas' : `Issue Atlas · ${repository}`

export const webviewOptions = (extensionUri: vscode.Uri): vscode.WebviewOptions => ({
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIRECTORY)],
})

const colorModeFor = (kind: vscode.ColorThemeKind): ColorMode =>
  kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
    ? 'light'
    : 'dark'

const webviewHtml = (
  webview: vscode.Webview,
  { extensionUri, credentialDescription }: PanelEnvironment,
  initialRepository: string | null,
): string => {
  const root = vscode.Uri.joinPath(extensionUri, ...WEBVIEW_DIRECTORY)
  const resource = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(root, name)).toString()
  return renderWebviewHtml({
    cspSource: webview.cspSource,
    nonce: randomBytes(18).toString('base64'),
    scriptUri: resource(WEBVIEW_SCRIPT),
    stylesheetUri: resource(WEBVIEW_STYLESHEET),
    config: {
      initialRepository: initialRepository ?? '',
      colorMode: colorModeFor(vscode.window.activeColorTheme.kind),
      credentialDescription: credentialDescription(),
    },
  })
}

const EXPORT_FILTERS: Readonly<Record<string, Record<string, string[]>>> = {
  json: { JSON: ['json'] },
  png: { PNG: ['png'] },
  svg: { SVG: ['svg'] },
}

const defaultExportDirectory = (): vscode.Uri =>
  vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir())

/** Webviews cannot download files, so exports go through a native save dialog. */
const saveExport = async (file: ExportFile): Promise<void> => {
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1)
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(defaultExportDirectory(), file.name),
    filters: EXPORT_FILTERS[extension] ?? {},
    saveLabel: 'Export',
    title: 'Export from Issue Atlas',
  })
  if (target === undefined) return
  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(file.data, file.encoding))
    void vscode.window.showInformationMessage(
      `Issue Atlas exported ${posix.basename(target.path)}.`,
    )
  } catch {
    void vscode.window.showErrorMessage(`Issue Atlas could not write ${file.name}.`)
  }
}

const normalizedRepository = (value: string | null): string | null | undefined => {
  if (value === null) return null
  try {
    return parseRepositoryInput(value).nameWithOwner
  } catch {
    return undefined
  }
}

const failureMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : 'GitHub request failed.'

/**
 * Connects a webview panel to GitHub. Credentials stay in the extension host; the webview only
 * receives validated repository data.
 */
export const attachGraphPanel = (
  panel: vscode.WebviewPanel,
  environment: PanelEnvironment,
  initialRepository: string | null,
  onDispose: () => void,
): GraphPanel => {
  let repository = initialRepository
  let transport: GraphQlTransport | null = null
  let disposed = false
  const requests = new Map<number, AbortController>()

  const post = (message: HostMessage): void => {
    if (!disposed) void panel.webview.postMessage(message)
  }

  const run = async (requestId: number, task: (signal: AbortSignal) => Promise<void>) => {
    requests.get(requestId)?.abort()
    const controller = new AbortController()
    requests.set(requestId, controller)
    try {
      await task(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        post({ type: 'request-failed', requestId, message: failureMessage(error) })
      }
    } finally {
      if (requests.get(requestId) === controller) requests.delete(requestId)
    }
  }

  const handle = async (message: WebviewMessage): Promise<void> => {
    switch (message.type) {
      case 'load-repository':
        return run(message.requestId, async (signal) => {
          const target = parseRepositoryInput(message.repository)
          transport = environment.createTransport()
          const publish = repositoryPageMessages(message.requestId, post)
          await fetchRepositorySnapshot(target, transport, publish, signal)
          post({ type: 'repository-loaded', requestId: message.requestId })
        })
      case 'load-issue-body':
        return run(message.requestId, async (signal) => {
          transport ??= environment.createTransport()
          const target = parseRepositoryInput(message.repository)
          const body = await fetchIssueBody(target, message.number, transport, signal)
          post({ type: 'issue-body', requestId: message.requestId, body })
        })
      case 'search-issues':
        return run(message.requestId, async (signal) => {
          transport ??= environment.createTransport()
          const target = parseRepositoryInput(message.repository)
          const result = await searchRepositoryIssues(target, message.query, transport, signal)
          post({ type: 'search-results', requestId: message.requestId, result })
        })
      case 'cancel':
        requests.get(message.requestId)?.abort()
        return
      case 'save-file':
        return saveExport(message.file)
      case 'repository-changed': {
        const next = normalizedRepository(message.repository)
        if (next === undefined) return
        repository = next
        panel.title = panelTitle(next)
      }
    }
  }

  panel.webview.options = webviewOptions(environment.extensionUri)
  panel.title = panelTitle(repository)
  panel.webview.onDidReceiveMessage((raw: unknown) => {
    const message = parseWebviewMessage(raw)
    if (message !== null) void handle(message)
  })
  panel.onDidDispose(() => {
    disposed = true
    for (const controller of requests.values()) controller.abort()
    requests.clear()
    onDispose()
  })
  panel.webview.html = webviewHtml(panel.webview, environment, repository)

  return {
    repository: () => repository,
    reveal: () => panel.reveal(),
  }
}
