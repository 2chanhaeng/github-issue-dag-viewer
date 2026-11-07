import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryLoadUpdate } from '../src/domain/types'
import type { HostMessage, WebviewMessage } from '../src/platform/protocol'
import {
  syncDocumentColorMode,
  type VsCodeWebviewApi,
  vscodeColorModes,
  vscodePlatform,
} from '../src/platform/vscode'
import { repository } from './github-client-fixtures'

const config = {
  initialRepository: 'octo-org/roadmap',
  colorMode: 'dark' as const,
  credentialDescription: 'No token needed.',
}

const fakeApi = () => {
  const posted: WebviewMessage[] = []
  const api: VsCodeWebviewApi = {
    postMessage: (message) => posted.push(message),
    setState: vi.fn(),
  }
  return { api, posted }
}

const deliver = (message: HostMessage): void => {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

const metadata = {
  repository,
  description: null,
  isPrivate: false,
  fetchedAt: '2026-11-07T00:00:00Z',
  rateLimit: null,
}

const issue = (number: number) => ({ key: `octo-org/roadmap#${number}` }) as never

afterEach(() => {
  document.body.className = ''
  document.body.removeAttribute('data-vscode-theme-kind')
})

describe('vscodePlatform', () => {
  it('lets the host own credentials', () => {
    const { api } = fakeApi()
    const platform = vscodePlatform(api, config, window, document)

    expect(platform.credentials).toEqual({ kind: 'host', description: 'No token needed.' })
    expect(platform.initialRepository).toBe('octo-org/roadmap')
  })

  it('accumulates streamed repository pages', async () => {
    const { api, posted } = fakeApi()
    const source = vscodePlatform(api, config, window, document).openSource('')
    const updates: RepositoryLoadUpdate[] = []

    const loading = source.loadRepository(
      repository,
      (update) => updates.push(update),
      new AbortController().signal,
    )
    expect(posted).toEqual([
      { type: 'load-repository', requestId: 1, repository: 'octo-org/roadmap' },
    ])
    deliver({
      type: 'repository-page',
      requestId: 1,
      progress: { loaded: 1, total: 2 },
      snapshot: metadata,
      issues: [issue(1)],
    })
    deliver({
      type: 'repository-page',
      requestId: 1,
      progress: { loaded: 2, total: 2 },
      snapshot: metadata,
      issues: [issue(2)],
    })
    deliver({ type: 'issue-body', requestId: 99, body: 'unrelated' })
    deliver({ type: 'repository-loaded', requestId: 1 })

    const snapshot = await loading
    expect(snapshot.issues.map(({ key }) => key)).toEqual([
      'octo-org/roadmap#1',
      'octo-org/roadmap#2',
    ])
    expect(updates.map(({ snapshot: partial }) => partial.issues.length)).toEqual([1, 2])
  })

  it('rejects with the host failure message', async () => {
    const { api, posted } = fakeApi()
    const source = vscodePlatform(api, config, window, document).openSource('')

    const loading = source.loadIssueBody(repository, 4, new AbortController().signal)
    const request = posted[0]
    if (request?.type !== 'load-issue-body') throw new Error('Expected an issue body request.')
    deliver({ type: 'request-failed', requestId: request.requestId, message: 'Sign-in cancelled.' })

    await expect(loading).rejects.toThrow('Sign-in cancelled.')
  })

  it('cancels the host request when the viewer aborts', async () => {
    const { api, posted } = fakeApi()
    const source = vscodePlatform(api, config, window, document).openSource('')
    const controller = new AbortController()

    const loading = source.loadIssueBody(repository, 4, controller.signal)
    controller.abort()

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(posted.at(-1)).toEqual({ type: 'cancel', requestId: 1 })
  })

  it('sends exports and repository changes to the host', () => {
    const { api, posted } = fakeApi()
    const platform = vscodePlatform(api, config, window, document)
    const file = { name: 'graph.svg', mimeType: 'image/svg+xml', encoding: 'utf8', data: '<svg/>' }

    platform.saveFile(file as never)
    platform.rememberRepository('octo-org/next')

    expect(posted).toEqual([
      { type: 'save-file', file },
      { type: 'repository-changed', repository: 'octo-org/next' },
    ])
    expect(api.setState).toHaveBeenCalledWith({ repository: 'octo-org/next' })
  })
})

describe('vscodeColorModes', () => {
  it('follows the VS Code theme kind instead of the operating system', async () => {
    const source = vscodeColorModes(document, 'dark')
    const stop = syncDocumentColorMode(source, document)
    expect(document.documentElement.dataset.colorMode).toBe('dark')

    document.body.setAttribute('data-vscode-theme-kind', 'vscode-high-contrast-light')
    await Promise.resolve()

    expect(source.current()).toBe('light')
    expect(document.documentElement.dataset.colorMode).toBe('light')
    stop()
  })
})
