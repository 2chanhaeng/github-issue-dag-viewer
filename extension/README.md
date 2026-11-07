# Issue Atlas for VS Code

Issue Atlas turns native GitHub issue dependencies into an interactive directed graph. It shows ready and blocked work, dependency cycles, critical paths, and the upstream or downstream impact of a selected issue, in an editor tab next to your code.

## Open a graph

Run **Issue Atlas: Open Issue Dependency Graph** from the Command Palette.

- With one github.com remote in the workspace, Issue Atlas loads that repository immediately.
- With several, it asks which one to open. `upstream` is listed before `origin`, because forks usually keep their issues upstream.
- Without one, it opens the offline demo. Use **Open repository** to load any `owner/repository`.

Panels reopen with their repository after VS Code restarts.

## Authentication

No personal access token is needed.

| `issueAtlas.authentication.provider` | Behavior |
| --- | --- |
| `auto` (default) | Uses GitHub CLI when it is installed and signed in, otherwise asks to sign in with the GitHub account in VS Code. |
| `githubCli` | Always uses GitHub CLI. |
| `vscode` | Always uses the GitHub account in VS Code. |

With GitHub CLI, every request runs as `gh api graphql --hostname github.com`. GitHub CLI keeps its credential, and Issue Atlas never reads it. Run `gh auth login` once if `gh` is not signed in. Set `issueAtlas.githubCli.path` when `gh` is not on the `PATH` that VS Code inherits; this setting is machine-scoped, so a workspace cannot override it.

With the VS Code account, Issue Atlas requests the `repo` OAuth scope, because GitHub OAuth has no read-only scope that covers private repository issues. Issue Atlas only sends read-only GraphQL queries.

In both cases the extension host performs the GitHub requests. The graph webview never receives a credential and cannot open network connections.

## Exports

**Export**, **SVG**, and **PNG** open a save dialog and write the file where you choose.

## Limits

Only github.com repositories are supported. Each issue's dependency connections are capped at 100 relationships, cross-repository nodes contain partial metadata, and graph layout is gated above 1,000 issues.
