import { parseRepositoryInput } from '../../src/github/parse-repository'
import type { RepositoryCandidate } from './remotes'

/** Identifiers contributed in `extension/package.json`. */
export const COMMANDS = {
  openGraph: 'issueAtlas.openGraph',
  openRepository: 'issueAtlas.openRepository',
  openDemo: 'issueAtlas.openDemo',
  refreshRepositories: 'issueAtlas.refreshRepositories',
} as const

export const ACTIVITY_BAR_CONTAINER = 'issueAtlas'
export const REPOSITORIES_VIEW = 'issueAtlas.repositories'

/** Follows `InputBoxOptions.validateInput`: `undefined` accepts the value. */
export const repositoryInputError = (value: string): string | undefined => {
  try {
    parseRepositoryInput(value)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Enter a GitHub repository.'
  }
}

export interface RepositoryItem {
  label: string
  description: string
  tooltip: string
  command: { command: string; title: string; arguments: [string] }
}

export const repositoryItem = ({
  nameWithOwner,
  remotes,
}: RepositoryCandidate): RepositoryItem => ({
  label: nameWithOwner,
  description: remotes.join(', '),
  tooltip: `Open the issue dependency graph for ${nameWithOwner}`,
  command: {
    command: COMMANDS.openGraph,
    title: 'Open Issue Dependency Graph',
    arguments: [nameWithOwner],
  },
})
