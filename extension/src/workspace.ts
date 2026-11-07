import * as vscode from 'vscode'
import { type GitRemote, type RepositoryCandidate, repositoryCandidates } from './remotes'

/** The subset of the built-in Git extension API (version 1) that Issue Atlas reads. */
export interface GitRepository {
  readonly state: {
    readonly remotes: readonly GitRemote[]
    readonly onDidChange: vscode.Event<void>
  }
}

export interface GitApi {
  readonly repositories: readonly GitRepository[]
  readonly onDidOpenRepository: vscode.Event<GitRepository>
  readonly onDidCloseRepository: vscode.Event<GitRepository>
}

interface GitExtension {
  getAPI: (version: 1) => GitApi
}

/** Resolves `null` when the Git extension is absent or disabled, as in restricted mode. */
export const workspaceGit = async (): Promise<GitApi | null> => {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')
  if (extension === undefined) return null
  try {
    const git = extension.isActive ? extension.exports : await extension.activate()
    return git.getAPI(1)
  } catch {
    return null
  }
}

export const workspaceRepositories = (git: GitApi | null): RepositoryCandidate[] =>
  repositoryCandidates(git?.repositories.flatMap(({ state }) => state.remotes) ?? [])
