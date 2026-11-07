export const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

export interface GraphQlEnvelope {
  data?: unknown
  errors?: unknown[]
}

/**
 * Sends one GraphQL document to github.com and resolves with the decoded response envelope.
 * Implementations own authentication and transport failures; callers own envelope validation.
 */
export type GraphQlTransport = (
  query: string,
  variables: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
) => Promise<GraphQlEnvelope>

export class GitHubGraphQlError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'GitHubGraphQlError'
  }
}

export const isGraphQlEnvelope = (value: unknown): value is GraphQlEnvelope =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const tokenTransport =
  (token: string): GraphQlTransport =>
  async (query, variables, signal) => {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    })

    let envelope: unknown
    try {
      envelope = await response.json()
    } catch {
      throw new GitHubGraphQlError(
        response.ok
          ? 'GitHub returned an unexpected GraphQL response.'
          : `GitHub returned HTTP ${response.status}.`,
      )
    }
    if (!response.ok) {
      throw new GitHubGraphQlError(`GitHub returned HTTP ${response.status}.`)
    }
    if (!isGraphQlEnvelope(envelope)) {
      throw new GitHubGraphQlError('GitHub returned an unexpected GraphQL response.')
    }
    return envelope
  }
