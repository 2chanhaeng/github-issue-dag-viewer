import { describe, expect, it } from 'vitest'
import { parseWebviewMessage } from '../extension/src/messages'
import { repositoryPageMessages } from '../extension/src/repository-stream'
import { contentSecurityPolicy, renderWebviewHtml } from '../extension/src/webview-html'
import type { HostMessage } from '../src/platform/protocol'

const document = (initialRepository: string) =>
  renderWebviewHtml({
    cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
    nonce: 'n0nce',
    scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/webview.js',
    stylesheetUri: 'https://file+.vscode-resource.vscode-cdn.net/webview.css',
    config: { initialRepository, colorMode: 'dark', credentialDescription: 'No token needed.' },
  })

describe('renderWebviewHtml', () => {
  it('allows only nonce-tagged and extension scripts and no network connections', () => {
    const policy = contentSecurityPolicy('vscode-resource:', 'n0nce')

    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("script-src 'nonce-n0nce' vscode-resource:")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).not.toContain('unsafe-eval')
    expect(document('octo-org/roadmap')).toContain('<script type="module" nonce="n0nce"')
  })

  it('cannot be escaped through embedded configuration', () => {
    const html = document('</script><script>alert(1)</script>')

    expect(html.match(/<script/g)).toHaveLength(2)
    expect(html).toContain('\\u003c/script\\u003e')
  })
})

describe('parseWebviewMessage', () => {
  it('accepts well-formed requests', () => {
    expect(
      parseWebviewMessage({ type: 'load-repository', requestId: 1, repository: 'octo-org/a' }),
    ).toEqual({ type: 'load-repository', requestId: 1, repository: 'octo-org/a' })
    expect(
      parseWebviewMessage({
        type: 'search-issues',
        requestId: 2,
        repository: 'octo-org/a',
        query: 'mentions:monalisa',
      }),
    ).toEqual({
      type: 'search-issues',
      requestId: 2,
      repository: 'octo-org/a',
      query: 'mentions:monalisa',
    })
  })

  it.each([
    { type: 'load-repository', requestId: 0, repository: 'octo-org/a' },
    { type: 'load-issue-body', requestId: 1, repository: 'octo-org/a', number: 1.5 },
    { type: 'search-issues', requestId: 1, repository: 'octo-org/a', query: '' },
    { type: 'search-issues', requestId: 1, repository: 'octo-org/a', query: 'x'.repeat(4_097) },
    {
      type: 'save-file',
      file: { name: '../../.ssh/config.json', mimeType: 'x', encoding: 'utf8', data: '' },
    },
    { type: 'save-file', file: { name: 'graph.exe', mimeType: 'x', encoding: 'utf8', data: '' } },
    { type: 'run-command', command: 'workbench.action.terminal.new' },
    'load-repository',
  ])('rejects %j', (message) => {
    expect(parseWebviewMessage(message)).toBeNull()
  })
})

describe('repositoryPageMessages', () => {
  it('posts only the issues added by each page', () => {
    const posted: HostMessage[] = []
    const publish = repositoryPageMessages(7, (message) => posted.push(message))
    const snapshot = (keys: string[]) => ({
      repository: { owner: 'o', name: 'r', nameWithOwner: 'o/r', url: 'https://github.com/o/r' },
      description: null,
      isPrivate: false,
      isArchived: false,
      primaryLanguage: null,
      viewerLogin: null,
      fetchedAt: '2026-11-07T00:00:00Z',
      rateLimit: null,
      issues: keys.map((key) => ({ key }) as never),
    })

    publish({ progress: { loaded: 1, total: 2 }, snapshot: snapshot(['o/r#1']) })
    publish({ progress: { loaded: 2, total: 2 }, snapshot: snapshot(['o/r#1', 'o/r#2']) })

    expect(
      posted.map((message) =>
        message.type === 'repository-page' ? message.issues.map(({ key }) => key) : [],
      ),
    ).toEqual([['o/r#1'], ['o/r#2']])
    expect(posted[1]).not.toHaveProperty('snapshot.issues')
  })
})
