import type { WebviewMessage, WebviewState } from '../src/platform/protocol'
import type { VsCodeWebviewApi } from '../src/platform/vscode'

/** Stands in for the VS Code webview host: records outgoing messages and persisted state. */
interface HarnessHost {
  posted: WebviewMessage[]
  state: WebviewState | null
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeWebviewApi
    issueAtlasHost: HarnessHost
  }
}

const host: HarnessHost = { posted: [], state: null }
window.issueAtlasHost = host
window.acquireVsCodeApi = () => ({
  postMessage: (message) => host.posted.push(message),
  setState: (state) => {
    host.state = state
  },
})

await import('../src/webview')
