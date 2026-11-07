import { execFile } from 'node:child_process'
import {
  GitHubGraphQlError,
  type GraphQlEnvelope,
  type GraphQlTransport,
  isGraphQlEnvelope,
} from '../../src/github/transport'

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Runs an executable without a shell, writes `input` to its stdin, and reports its exit code. */
export type ProcessRunner = (
  file: string,
  args: readonly string[],
  input: string,
  signal?: AbortSignal,
) => Promise<ProcessResult>

export type GitHubCliProblem = 'missing' | 'signed-out'

const PROBLEM_MESSAGES: Readonly<Record<GitHubCliProblem, string>> = {
  missing: 'GitHub CLI (gh) was not found. Install it or set issueAtlas.githubCli.path.',
  'signed-out': 'GitHub CLI is not signed in to github.com. Run “gh auth login” in a terminal.',
}

/** GitHub CLI cannot serve requests at all, so another credential source may take over. */
export class GitHubCliUnavailableError extends Error {
  public readonly problem: GitHubCliProblem

  public constructor(problem: GitHubCliProblem) {
    super(PROBLEM_MESSAGES[problem])
    this.name = 'GitHubCliUnavailableError'
    this.problem = problem
  }
}

/** `gh` exits with 4 when a command requires authentication that is not configured. */
const GH_AUTH_REQUIRED_EXIT_CODE = 4
const GH_GRAPHQL_ARGS = ['api', 'graphql', '--hostname', 'github.com', '--input', '-'] as const
const GH_TIMEOUT_MS = 120_000
const GH_MAX_OUTPUT_BYTES = 64 * 1_024 * 1_024

const GH_ENVIRONMENT = {
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_PROMPT_DISABLED: '1',
  GH_SPINNER_DISABLED: '1',
  NO_COLOR: '1',
} as const

interface ChildProcessFailure {
  code?: unknown
  killed?: unknown
  name?: unknown
}

const failure = (error: unknown): ChildProcessFailure =>
  typeof error === 'object' && error !== null ? error : {}

export const execFileRunner: ProcessRunner = (file, args, input, signal) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        encoding: 'utf8',
        env: { ...process.env, ...GH_ENVIRONMENT },
        maxBuffer: GH_MAX_OUTPUT_BYTES,
        timeout: GH_TIMEOUT_MS,
        windowsHide: true,
        ...(signal === undefined ? {} : { signal }),
      },
      (error, stdout, stderr) => {
        if (error === null) resolve({ exitCode: 0, stdout, stderr })
        else if (typeof error.code === 'number') resolve({ exitCode: error.code, stdout, stderr })
        else reject(error)
      },
    )
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input)
  })

const startFailure = (error: unknown): Error => {
  const { code, killed, name } = failure(error)
  if (name === 'AbortError') return error as Error
  if (code === 'ENOENT') return new GitHubCliUnavailableError('missing')
  if (killed === true) return new GitHubGraphQlError('GitHub CLI did not respond in time.')
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new GitHubGraphQlError('GitHub CLI returned more data than Issue Atlas accepts.')
  }
  return new GitHubGraphQlError('GitHub CLI could not be started.')
}

const parseEnvelope = (stdout: string): GraphQlEnvelope | null => {
  try {
    const value: unknown = JSON.parse(stdout)
    return isGraphQlEnvelope(value) ? value : null
  } catch {
    return null
  }
}

const HTTP_STATUS_PATTERN = /\(HTTP (\d{3})\)/

/**
 * Maps a finished `gh api graphql` run onto the same bounded results as the token transport.
 * Raw stdout and stderr never reach error messages because they can echo response content.
 */
export const interpretGitHubCliResult = ({
  exitCode,
  stdout,
  stderr,
}: ProcessResult): GraphQlEnvelope => {
  if (exitCode === GH_AUTH_REQUIRED_EXIT_CODE) throw new GitHubCliUnavailableError('signed-out')

  const envelope = parseEnvelope(stdout)
  if (exitCode === 0) {
    if (envelope === null) {
      throw new GitHubGraphQlError('GitHub returned an unexpected GraphQL response.')
    }
    return envelope
  }

  const status = HTTP_STATUS_PATTERN.exec(stderr)?.[1]
  if (status !== undefined) throw new GitHubGraphQlError(`GitHub returned HTTP ${status}.`)
  if (envelope !== null && (envelope.errors?.length ?? 0) > 0) return envelope
  throw new GitHubGraphQlError('GitHub CLI could not complete the request.')
}

/** Sends GraphQL through `gh api`, so GitHub CLI owns authentication and the token never leaves it. */
export const githubCliTransport =
  (run: ProcessRunner, executable: string): GraphQlTransport =>
  async (query, variables, signal) => {
    let result: ProcessResult
    try {
      result = await run(executable, GH_GRAPHQL_ARGS, JSON.stringify({ query, variables }), signal)
    } catch (error) {
      throw startFailure(error)
    }
    return interpretGitHubCliResult(result)
  }
