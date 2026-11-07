import { describe, expect, it, vi } from 'vitest'
import {
  GitHubCliUnavailableError,
  githubCliTransport,
  type ProcessResult,
  type ProcessRunner,
} from '../extension/src/github-cli'
import { fetchIssueBody, fetchRepositorySnapshot, GitHubGraphQlError } from '../src/github/client'
import { issueDetails, issueNode, repository, repositoryPage } from './github-client-fixtures'

const result = (overrides: Partial<ProcessResult>): ProcessResult => ({
  exitCode: 0,
  stdout: '',
  stderr: '',
  ...overrides,
})

const runnerReturning = (...results: ProcessResult[]) => {
  const runner = vi.fn<ProcessRunner>()
  for (const next of results) runner.mockResolvedValueOnce(next)
  return runner
}

const json = (value: unknown): string => JSON.stringify(value)

describe('githubCliTransport', () => {
  it('sends the GraphQL document through gh on stdin', async () => {
    const run = runnerReturning(result({ stdout: json(repositoryPage({ nodes: [issueNode(1)] })) }))

    const snapshot = await fetchRepositorySnapshot(
      repository,
      githubCliTransport(run, '/opt/gh'),
      vi.fn(),
    )

    expect(snapshot.issues.map(({ key }) => key)).toEqual(['octo-org/roadmap#1'])
    const [file, args, input] = run.mock.calls[0] ?? []
    expect(file).toBe('/opt/gh')
    expect(args).toEqual(['api', 'graphql', '--hostname', 'github.com', '--input', '-'])
    expect(JSON.parse(input ?? '')).toMatchObject({
      variables: { owner: 'octo-org', name: 'roadmap', cursor: null },
    })
  })

  it('forwards cancellation to the process runner', async () => {
    const controller = new AbortController()
    const run = runnerReturning(result({ stdout: json(issueDetails('Body')) }))

    await fetchIssueBody(repository, 42, githubCliTransport(run, 'gh'), controller.signal)

    expect(run.mock.calls[0]?.[3]).toBe(controller.signal)
  })

  it('reports a signed-out GitHub CLI as unavailable', async () => {
    const run = runnerReturning(
      result({ exitCode: 4, stderr: 'To get started with GitHub CLI, please run: gh auth login' }),
    )

    const error = await fetchIssueBody(repository, 1, githubCliTransport(run, 'gh')).catch(
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(GitHubCliUnavailableError)
    expect(error).toMatchObject({ problem: 'signed-out' })
  })

  it('reports a missing executable as unavailable', async () => {
    const run = vi
      .fn<ProcessRunner>()
      .mockRejectedValue(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }))

    await expect(
      fetchIssueBody(repository, 1, githubCliTransport(run, 'gh')),
    ).rejects.toMatchObject({ name: 'GitHubCliUnavailableError', problem: 'missing' })
  })

  it('rethrows aborts unchanged', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    const run = vi.fn<ProcessRunner>().mockRejectedValue(abort)

    await expect(fetchIssueBody(repository, 1, githubCliTransport(run, 'gh'))).rejects.toBe(abort)
  })

  it.each([
    [
      'HTTP failure',
      result({
        exitCode: 1,
        stdout: json({ message: 'Bad credentials' }),
        stderr: 'gh: Bad credentials (HTTP 401)',
      }),
      'GitHub returned HTTP 401.',
    ],
    [
      'GraphQL failure',
      result({
        exitCode: 1,
        stdout: json({ data: { repository: null }, errors: [{ message: 'secret detail' }] }),
        stderr: 'gh: secret detail',
      }),
      'GitHub rejected the GraphQL request.',
    ],
    [
      'unexpected failure',
      result({ exitCode: 1, stdout: 'not json', stderr: 'gh: secret detail' }),
      'GitHub CLI could not complete the request.',
    ],
    [
      'unexpected success output',
      result({ stdout: 'not json' }),
      'GitHub returned an unexpected GraphQL response.',
    ],
  ])('bounds a %s without echoing gh output', async (_name, output, message) => {
    const error = await fetchRepositorySnapshot(
      repository,
      githubCliTransport(runnerReturning(output), 'gh'),
      vi.fn(),
    ).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(GitHubGraphQlError)
    expect(String(error)).toContain(message)
    expect(String(error)).not.toContain('secret detail')
  })
})
