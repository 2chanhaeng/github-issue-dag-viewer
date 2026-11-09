# Issue Atlas

Issue Atlas turns native GitHub issue dependencies into an interactive directed graph. It shows ready and blocked work, dependency cycles, critical paths, and the upstream or downstream impact of a selected issue.

[Open the hosted viewer](https://ccheney.github.io/github-issue-dag-viewer/)

The included implementation blueprint works without a token. The viewer is read-only and can load any accessible `github.com` repository directly from the browser.

## A graph that built itself

The demo DAG is the real implementation plan for Issue Atlas. Its [GitHub issues](https://github.com/ccheney/github-issue-dag-viewer/issues?q=is%3Aissue%20state%3Aclosed) encode outcomes, scope, acceptance criteria, and native dependencies, forming a living, executable specification instead of sample data.

I set a `./goal` in Codex to implement the graph autonomously. The DAG supplied global sequencing while Codex handled each task through its own implementation and verification loop. The completed graph now demonstrates the app it specified—a self-fulfilling workflow.

## Use a GitHub repository

1. Open **Open repository**.
2. Enter `owner/repository` or a GitHub repository URL.
3. Supply a [fine-grained token with Issues read access](https://github.com/settings/personal-access-tokens/new?name=Issue%20Atlas&description=Read%20issue%20dependency%20graphs&expires_in=30&issues=read).
4. Choose **Load repository**.

GitHub GraphQL requires authentication for public and private repositories. Limit the token to the repositories you want to inspect with **Issues: Read-only** permission. Issue Atlas sends it only to `https://api.github.com/graphql`, keeps it in memory for the current tab, and never writes it to storage, URLs, logs, exports, source maps, or deployment artifacts. Refreshing or closing the tab discards it.

## Use in VS Code

The VS Code extension opens the same viewer in an editor tab without a token. It sends requests through [GitHub CLI](https://cli.github.com/) (`gh api graphql`) when `gh` is signed in, and otherwise asks to sign in with the GitHub account in VS Code. Credentials stay in the extension host and never reach the viewer.

```sh
bun install --frozen-lockfile
bun run package:vscode
code --install-extension extension/issue-atlas-1.1.1.vsix
```

Select the **Issue Atlas** icon in the Activity Bar to list the workspace's github.com repositories and open one, or run **Issue Atlas: Open Issue Dependency Graph** from the Command Palette. See [the extension README](./extension/README.md) for settings.

## Run locally

Install the pinned Bun version from [`.tool-versions`](./.tool-versions), then:

```sh
git clone https://github.com/ccheney/github-issue-dag-viewer.git
cd github-issue-dag-viewer
bun install --frozen-lockfile
bun run dev
```

Open the URL printed by Vite. Demo mode requires no additional setup.

## Verify changes

Install Chromium once before running browser tests:

```sh
bunx playwright install chromium
```

| Command | Checks |
| --- | --- |
| `bun run check` | Formatting, linting, and strict TypeScript |
| `bun run test` | Unit and GitHub client contract tests |
| `bun run test:e2e` | Desktop, mobile, and accessibility workflows |
| `bun run build` | Production build and compressed bundle budgets |
| `bun run build:vscode` | VS Code webview bundle and extension host |
| `bun run package:vscode` | VS Code extension package (`.vsix`) |
| `bun run verify` | The complete CI gate |

## Limits and documentation

Dependency connections are capped at 100 relationships per issue, cross-repository nodes contain partial metadata, and graph layout is gated above 1,000 issues. The search field accepts GitHub issue search syntax; qualifiers that the loaded data cannot answer are sent to GitHub search, which returns at most 1,000 matches per query. SVG and JSON remain available when a PNG export exceeds the measured limits.

- [Contributor and operations guide](./docs/contributor-guide.md)
- [Product and architecture plans](./docs/plans/README.md)
- [VS Code extension plan](./docs/plans/06-vscode-extension.md)
- [Large-graph benchmark](./docs/performance/large-graph-benchmark.md)

## License

[MIT](./LICENSE) © 2026 Chris Cheney
