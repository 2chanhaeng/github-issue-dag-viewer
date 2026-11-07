import * as vscode from 'vscode'
import { REPOSITORIES_VIEW, repositoryItem } from './commands'
import type { RepositoryCandidate } from './remotes'
import { type GitApi, type GitRepository, workspaceRepositories } from './workspace'

export interface RepositoryView extends vscode.Disposable {
  refresh: () => void
}

const repositoryTreeItem = (candidate: RepositoryCandidate): vscode.TreeItem => {
  const { label, description, tooltip, command } = repositoryItem(candidate)
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None)
  item.description = description
  item.tooltip = tooltip
  item.command = command
  item.iconPath = new vscode.ThemeIcon('repo')
  item.contextValue = 'repository'
  return item
}

/**
 * Lists workspace github.com repositories in the Activity Bar view. The Git extension discovers
 * repositories and their remotes after activation, so the view follows its events and re-renders
 * only when the repository list actually changes.
 */
export const registerRepositoryView = (git: Promise<GitApi | null>): RepositoryView => {
  const changes = new vscode.EventEmitter<void>()
  const disposables: vscode.Disposable[] = [changes]
  const watchers = new Map<GitRepository, vscode.Disposable>()
  let rendered: string | null = null
  let disposed = false

  const read = async (): Promise<RepositoryCandidate[]> => workspaceRepositories(await git)
  const refreshIfChanged = async (): Promise<void> => {
    const next = JSON.stringify(await read())
    if (next === rendered) return
    rendered = next
    changes.fire()
  }
  const watch = (repository: GitRepository): void => {
    watchers.set(
      repository,
      repository.state.onDidChange(() => void refreshIfChanged()),
    )
  }

  const provider: vscode.TreeDataProvider<RepositoryCandidate> = {
    onDidChangeTreeData: changes.event,
    getChildren: async (element) => {
      if (element !== undefined) return []
      const candidates = await read()
      rendered = JSON.stringify(candidates)
      return candidates
    },
    getTreeItem: repositoryTreeItem,
  }
  disposables.push(vscode.window.createTreeView(REPOSITORIES_VIEW, { treeDataProvider: provider }))

  void git.then((api) => {
    if (api === null || disposed) return
    api.repositories.forEach(watch)
    disposables.push(
      api.onDidOpenRepository((repository) => {
        watch(repository)
        void refreshIfChanged()
      }),
      api.onDidCloseRepository((repository) => {
        watchers.get(repository)?.dispose()
        watchers.delete(repository)
        void refreshIfChanged()
      }),
    )
  })

  return {
    refresh: () => changes.fire(),
    dispose: () => {
      disposed = true
      for (const disposable of [...disposables, ...watchers.values()]) disposable.dispose()
      watchers.clear()
    },
  }
}
