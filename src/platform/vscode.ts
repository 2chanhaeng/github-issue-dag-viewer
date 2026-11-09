import type { IssueSearchResult, RepositorySnapshot } from '../domain/types'
import type { ColorMode, ColorModeSource } from '../hooks/use-color-mode'
import {
  type HostMessage,
  WEBVIEW_CONFIG_ELEMENT_ID,
  type WebviewConfig,
  type WebviewMessage,
  type WebviewState,
} from './protocol'
import type { IssueSource, ViewerPlatform } from './types'

/** The subset of the object returned by VS Code's webview `acquireVsCodeApi()`. */
export interface VsCodeWebviewApi {
  postMessage: (message: WebviewMessage) => void
  setState: (state: WebviewState) => void
}

type PendingHandler = (message: HostMessage) => void

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')

const isHostMessage = (value: unknown): value is HostMessage =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { requestId?: unknown }).requestId === 'number'

/**
 * Correlates webview requests with streamed host responses. Aborting a request rejects it locally
 * and asks the host to cancel the underlying GitHub call.
 */
const createRequester = (api: VsCodeWebviewApi, target: Window) => {
  const pending = new Map<number, PendingHandler>()
  let nextRequestId = 1

  target.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isHostMessage(event.data)) pending.get(event.data.requestId)?.(event.data)
  })

  return <T>(
    start: (requestId: number) => WebviewMessage,
    handle: (message: HostMessage, resolve: (value: T) => void) => void,
    signal: AbortSignal,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError())
        return
      }
      const requestId = nextRequestId++
      const settle = (): void => {
        pending.delete(requestId)
        signal.removeEventListener('abort', abort)
      }
      const abort = (): void => {
        settle()
        api.postMessage({ type: 'cancel', requestId })
        reject(abortError())
      }
      pending.set(requestId, (message) => {
        if (message.type === 'request-failed') {
          settle()
          reject(new Error(message.message))
          return
        }
        handle(message, (value) => {
          settle()
          resolve(value)
        })
      })
      signal.addEventListener('abort', abort, { once: true })
      api.postMessage(start(requestId))
    })
}

export const hostIssueSource = (api: VsCodeWebviewApi, target: Window): IssueSource => {
  const request = createRequester(api, target)
  return {
    loadRepository: (repository, onUpdate, signal) => {
      let snapshot: RepositorySnapshot | null = null
      return request<RepositorySnapshot>(
        (requestId) => ({
          type: 'load-repository',
          requestId,
          repository: repository.nameWithOwner,
        }),
        (message, resolve) => {
          if (message.type === 'repository-page') {
            snapshot = {
              ...message.snapshot,
              issues: [...(snapshot?.issues ?? []), ...message.issues],
            }
            onUpdate({ progress: message.progress, snapshot })
          } else if (message.type === 'repository-loaded' && snapshot !== null) {
            resolve(snapshot)
          }
        },
        signal,
      )
    },
    loadIssueBody: (repository, number, signal) =>
      request<string>(
        (requestId) => ({
          type: 'load-issue-body',
          requestId,
          repository: repository.nameWithOwner,
          number,
        }),
        (message, resolve) => {
          if (message.type === 'issue-body') resolve(message.body)
        },
        signal,
      ),
    searchIssues: (repository, query, signal) =>
      request<IssueSearchResult>(
        (requestId) => ({
          type: 'search-issues',
          requestId,
          repository: repository.nameWithOwner,
          query,
        }),
        (message, resolve) => {
          if (message.type === 'search-results') resolve(message.result)
        },
        signal,
      ),
  }
}

const VSCODE_THEME_ATTRIBUTE = 'data-vscode-theme-kind'

const themeKindMode = (kind: string): ColorMode | null => {
  if (kind === 'vscode-light' || kind === 'vscode-high-contrast-light') return 'light'
  if (kind === 'vscode-dark' || kind === 'vscode-high-contrast') return 'dark'
  return null
}

/** VS Code marks the webview body with the active workbench theme kind and updates it live. */
export const vscodeThemeMode = (body: HTMLElement): ColorMode | null =>
  themeKindMode(body.getAttribute(VSCODE_THEME_ATTRIBUTE) ?? '') ??
  (body.classList.contains('vscode-high-contrast-light') || body.classList.contains('vscode-light')
    ? 'light'
    : body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast')
      ? 'dark'
      : null)

export const vscodeColorModes = (document: Document, fallback: ColorMode): ColorModeSource => ({
  followsSystem: false,
  current: () => vscodeThemeMode(document.body) ?? fallback,
  subscribe: (onChange) => {
    const observer = new MutationObserver(onChange)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', VSCODE_THEME_ATTRIBUTE],
    })
    return () => observer.disconnect()
  },
})

/** Primer tokens and portaled overlays read the document-level color mode attribute. */
export const syncDocumentColorMode = (
  source: ColorModeSource,
  document: Document,
): (() => void) => {
  const apply = (): void => {
    document.documentElement.dataset.colorMode = source.current()
  }
  apply()
  return source.subscribe(apply)
}

export const readWebviewConfig = (document: Document): WebviewConfig => {
  const element = document.getElementById(WEBVIEW_CONFIG_ELEMENT_ID)
  if (element === null) throw new Error('Issue Atlas webview configuration was not found.')
  return JSON.parse(element.textContent ?? '') as WebviewConfig
}

export const vscodePlatform = (
  api: VsCodeWebviewApi,
  config: WebviewConfig,
  target: Window,
  document: Document,
): ViewerPlatform => {
  const source = hostIssueSource(api, target)
  return {
    credentials: { kind: 'host', description: config.credentialDescription },
    initialRepository: config.initialRepository,
    colorModes: vscodeColorModes(document, config.colorMode),
    openSource: () => source,
    rememberRepository: (repository) => {
      api.setState({ repository })
      api.postMessage({ type: 'repository-changed', repository })
    },
    saveFile: (file) => api.postMessage({ type: 'save-file', file }),
  }
}
