import * as vscode from 'vscode'
import { type GraphQlTransport, tokenTransport } from '../../src/github/transport'
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
import { type GitRemote, repositoryCandidates } from './remotes'

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

/** The subset of the built-in Git extension API that Issue Atlas reads. */
interface GitExtension {
  getAPI: (version: 1) => {
    readonly repositories: readonly { readonly state: { readonly remotes: readonly GitRemote[] } }[]
  }
}

const workspaceRemotes = async (): Promise<GitRemote[]> => {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')
  if (extension === undefined) return []
  try {
    const git = extension.isActive ? extension.exports : await extension.activate()
    return git.getAPI(1).repositories.flatMap(({ state }) => state.remotes)
  } catch {
    return []
  }
}

/** Resolves `undefined` when the user dismisses the picker and `null` for the offline demo. */
const pickRepository = async (): Promise<string | null | undefined> => {
  const candidates = repositoryCandidates(await workspaceRemotes())
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

const restoredRepository = (state: unknown): string | null => {
  const repository = (state as { repository?: unknown } | null | undefined)?.repository
  return typeof repository === 'string' ? repository : null
}

const sameRepository = (left: string | null, right: string | null): boolean =>
  (left?.toLowerCase() ?? null) === (right?.toLowerCase() ?? null)

export const activate = (context: vscode.ExtensionContext): void => {
  const panels = new Set<GraphPanel>()
  const environment = panelEnvironment(context.extensionUri)

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
    vscode.commands.registerCommand('issueAtlas.openGraph', async (argument?: unknown) => {
      const repository = typeof argument === 'string' ? argument : await pickRepository()
      if (repository !== undefined) show(repository)
    }),
    vscode.window.registerWebviewPanelSerializer(GRAPH_VIEW_TYPE, {
      deserializeWebviewPanel: async (panel, state: unknown) =>
        attach(panel, restoredRepository(state)),
    }),
  )
}
