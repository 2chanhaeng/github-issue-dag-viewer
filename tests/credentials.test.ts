import { describe, expect, it, vi } from 'vitest'
import {
  createTransport,
  credentialDescription,
  credentialProvider,
} from '../extension/src/credentials'
import { GitHubCliUnavailableError } from '../extension/src/github-cli'
import { GitHubGraphQlError, type GraphQlTransport } from '../src/github/transport'

const envelope = { data: { ok: true } }

const transport = () => vi.fn<GraphQlTransport>().mockResolvedValue(envelope)

describe('credentialProvider', () => {
  it.each([
    ['githubCli', 'githubCli'],
    ['vscode', 'vscode'],
    ['auto', 'auto'],
    ['unexpected', 'auto'],
    [undefined, 'auto'],
  ])('reads %s as %s', (value, provider) => {
    expect(credentialProvider(value)).toBe(provider)
  })

  it('describes every provider without asking for a token', () => {
    for (const provider of ['auto', 'githubCli', 'vscode'] as const) {
      expect(credentialDescription(provider)).toMatch(/^No token needed\./)
    }
  })
})

describe('createTransport', () => {
  it('uses GitHub CLI while it serves requests', async () => {
    const githubCli = transport()
    const vscodeAccount = vi.fn<() => Promise<GraphQlTransport>>()

    const active = createTransport('auto', { githubCli, vscodeAccount })
    await active('query', {})
    await active('query', {})

    expect(githubCli).toHaveBeenCalledTimes(2)
    expect(vscodeAccount).not.toHaveBeenCalled()
  })

  it.each([
    'missing',
    'signed-out',
  ] as const)('falls back to the VS Code account when GitHub CLI is %s', async (problem) => {
    const githubCli = vi
      .fn<GraphQlTransport>()
      .mockRejectedValue(new GitHubCliUnavailableError(problem))
    const account = transport()
    const vscodeAccount = vi.fn<() => Promise<GraphQlTransport>>().mockResolvedValue(account)

    const active = createTransport('auto', { githubCli, vscodeAccount })

    await expect(active('first', {})).resolves.toBe(envelope)
    await expect(active('second', {})).resolves.toBe(envelope)
    expect(githubCli).toHaveBeenCalledTimes(1)
    expect(vscodeAccount).toHaveBeenCalledTimes(1)
    expect(account.mock.calls.map(([query]) => query)).toEqual(['first', 'second'])
  })

  it('does not hide GitHub failures behind a second sign-in', async () => {
    const failure = new GitHubGraphQlError('GitHub rejected the GraphQL request.')
    const githubCli = vi.fn<GraphQlTransport>().mockRejectedValue(failure)
    const vscodeAccount = vi.fn<() => Promise<GraphQlTransport>>()

    await expect(createTransport('auto', { githubCli, vscodeAccount })('query', {})).rejects.toBe(
      failure,
    )
    expect(vscodeAccount).not.toHaveBeenCalled()
  })

  it('keeps GitHub CLI failures visible when the CLI is required', async () => {
    const githubCli = vi
      .fn<GraphQlTransport>()
      .mockRejectedValue(new GitHubCliUnavailableError('missing'))
    const vscodeAccount = vi.fn<() => Promise<GraphQlTransport>>()

    await expect(
      createTransport('githubCli', { githubCli, vscodeAccount })('query', {}),
    ).rejects.toThrow('GitHub CLI (gh) was not found.')
    expect(vscodeAccount).not.toHaveBeenCalled()
  })

  it('signs in through VS Code once and retries after a cancelled sign-in', async () => {
    const account = transport()
    const vscodeAccount = vi
      .fn<() => Promise<GraphQlTransport>>()
      .mockRejectedValueOnce(new Error('cancelled'))
      .mockResolvedValue(account)
    const active = createTransport('vscode', { githubCli: transport(), vscodeAccount })

    await expect(active('query', {})).rejects.toThrow('cancelled')
    await active('query', {})
    await active('query', {})

    expect(vscodeAccount).toHaveBeenCalledTimes(2)
    expect(account).toHaveBeenCalledTimes(2)
  })
})
