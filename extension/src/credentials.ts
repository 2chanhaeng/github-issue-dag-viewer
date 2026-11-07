import type { GraphQlTransport } from '../../src/github/transport'
import { GitHubCliUnavailableError } from './github-cli'

export const CREDENTIAL_PROVIDERS = ['auto', 'githubCli', 'vscode'] as const
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number]

export const credentialProvider = (value: unknown): CredentialProvider =>
  CREDENTIAL_PROVIDERS.find((provider) => provider === value) ?? 'auto'

const DESCRIPTIONS: Readonly<Record<CredentialProvider, string>> = {
  auto: 'No token needed. Issue Atlas reads GitHub through your GitHub CLI (gh) sign-in, or through your VS Code GitHub account when gh is unavailable.',
  githubCli: 'No token needed. Issue Atlas reads GitHub through your GitHub CLI (gh) sign-in.',
  vscode: 'No token needed. Issue Atlas reads GitHub through your VS Code GitHub account.',
}

export const credentialDescription = (provider: CredentialProvider): string =>
  DESCRIPTIONS[provider]

/** Resolves a transport on first use and retries resolution after a failure such as a cancelled sign-in. */
export const deferredTransport = (resolve: () => Promise<GraphQlTransport>): GraphQlTransport => {
  let resolved: Promise<GraphQlTransport> | null = null
  return async (query, variables, signal) => {
    resolved ??= resolve().catch((error: unknown) => {
      resolved = null
      throw error
    })
    return (await resolved)(query, variables, signal)
  }
}

/**
 * Uses `primary` until it reports that GitHub CLI is unusable, then switches to `fallback` for the
 * rest of the session. Other failures, such as GraphQL or HTTP errors, are not retried.
 */
export const fallbackTransport = (
  primary: GraphQlTransport,
  fallback: GraphQlTransport,
): GraphQlTransport => {
  let active = primary
  return async (query, variables, signal) => {
    if (active === fallback) return fallback(query, variables, signal)
    try {
      return await primary(query, variables, signal)
    } catch (error) {
      if (!(error instanceof GitHubCliUnavailableError)) throw error
      active = fallback
      return fallback(query, variables, signal)
    }
  }
}

export interface CredentialSources {
  githubCli: GraphQlTransport
  vscodeAccount: () => Promise<GraphQlTransport>
}

export const createTransport = (
  provider: CredentialProvider,
  { githubCli, vscodeAccount }: CredentialSources,
): GraphQlTransport => {
  switch (provider) {
    case 'githubCli':
      return githubCli
    case 'vscode':
      return deferredTransport(vscodeAccount)
    case 'auto':
      return fallbackTransport(githubCli, deferredTransport(vscodeAccount))
  }
}
