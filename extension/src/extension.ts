import * as vscode from 'vscode'
import { parseRepositoryInput } from '../../src/github/parse-repository'
import { type GraphQlTransport, tokenTransport } from '../../src/github/transport'
import { COMMANDS, repositoryInputError } from './commands'
import { createTransport, credentialDescription, credentialProvider } from './credentials'
import { execFileRunner, githubCliTransport } from './github-cli'
import {
  attachGraphPanel,
  GRAPH_VIEW_TYPE,
  type GraphPanel,
  type PanelEnvironment,
  panelTitle,
  webviewOptions,
} from './panel'
import type { RepositoryCandidate } from './remotes'
import { registerRepositoryView } from './repository-view'
import { workspaceGit, workspaceRepositories } from './workspace'

/** GitHub OAuth has no read-only scope that covers private repository issues. */
const GITHUB_SCOPES = ['repo']

const settings = () => {
  const configuration = vscode.workspace.getConfiguration('issueAtlas')
  const githubCliPath = configuration.get<string>('githubCli.path', 'gh').trim()
  return {
    provider: credentialProvider(configuration.get('authentication.provider')),
    githubCliPath: githubCliPath.length > 0 ? githubCliPath : 'gh',
  }
}

const vscodeAccountTransport = async (): Promise<GraphQlTransport> => {
  try {
    const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, {
      createIfNone: true,
    })
    return tokenTransport(session.accessToken)
  } catch {
    throw new Error('GitHub sign-in through VS Code was cancelled or failed.')
  }
}

const panelEnvironment = (extensionUri: vscode.Uri): PanelEnvironment => ({
  extensionUri,
  createTransport: () => {
    const { provider, githubCliPath } = settings()
    return createTransport(provider, {
      githubCli: githubCliTransport(execFileRunner, githubCliPath),
      vscodeAccount: vscodeAccountTransport,
    })
  },
  credentialDescription: () => credentialDescription(settings().provider),
})

/** Resolves `undefined` when the user dismisses the picker and `null` for the offline demo. */
const pickRepository = async (
  candidates: readonly RepositoryCandidate[],
): Promise<string | null | undefined> => {
  if (candidates.length <= 1) return candidates[0]?.nameWithOwner ?? null
  const picked = await vscode.window.showQuickPick(
    candidates.map(({ nameWithOwner, remotes }) => ({
      label: nameWithOwner,
      description: remotes.join(', '),
    })),
    {
      matchOnDescription: true,
      placeHolder: 'Choose the repository whose issue dependencies to graph',
    },
  )
  return picked?.label
}

/** Resolves `undefined` when the user dismisses the input box. */
const promptForRepository = async (): Promise<string | undefined> => {
  const value = await vscode.window.showInputBox({
    title: 'Open Issue Dependency Graph',
    prompt: 'Enter owner/repository or a github.com repository URL.',
    placeHolder: 'owner/repository',
    ignoreFocusOut: true,
    validateInput: repositoryInputError,
  })
  return value === undefined ? undefined : parseRepositoryInput(value).nameWithOwner
}

const restoredRepository = (state: unknown): string | null => {
  const repository = (state as { repository?: unknown } | null | undefined)?.repository
  return typeof repository === 'string' ? repository : null
}

const sameRepository = (left: string | null, right: string | null): boolean =>
  (left?.toLowerCase() ?? null) === (right?.toLowerCase() ?? null)

export const activate = (context: vscode.ExtensionContext): void => {
  const panels = new Set<GraphPanel>()
  const environment = panelEnvironment(context.extensionUri)
  const git = workspaceGit()
  const repositoryView = registerRepositoryView(git)

  const attach = (panel: vscode.WebviewPanel, repository: string | null): void => {
    const graphPanel = attachGraphPanel(panel, environment, repository, () =>
      panels.delete(graphPanel),
    )
    panels.add(graphPanel)
  }

  const show = (repository: string | null): void => {
    const existing = [...panels].find((panel) => sameRepository(panel.repository(), repository))
    if (existing !== undefined) {
      existing.reveal()
      return
    }
    attach(
      vscode.window.createWebviewPanel(
        GRAPH_VIEW_TYPE,
        panelTitle(repository),
        vscode.ViewColumn.Active,
        { ...webviewOptions(context.extensionUri), retainContextWhenHidden: true },
      ),
      repository,
    )
  }

  context.subscriptions.push(
    repositoryView,
    vscode.commands.registerCommand(COMMANDS.openGraph, async (argument?: unknown) => {
      const repository =
        typeof argument === 'string'
          ? argument
          : await pickRepository(workspaceRepositories(await git))
      if (repository !== undefined) show(repository)
    }),
    vscode.commands.registerCommand(COMMANDS.openRepository, async () => {
      const repository = await promptForRepository()
      if (repository !== undefined) show(repository)
    }),
    vscode.commands.registerCommand(COMMANDS.openDemo, () => show(null)),
    vscode.commands.registerCommand(COMMANDS.refreshRepositories, () => repositoryView.refresh()),
    vscode.window.registerWebviewPanelSerializer(GRAPH_VIEW_TYPE, {
      deserializeWebviewPanel: async (panel, state: unknown) =>
        attach(panel, restoredRepository(state)),
    }),
  )
}
