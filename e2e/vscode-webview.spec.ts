import { expect, type Page, test } from '@playwright/test'
import { repositoryPageMessages } from '../extension/src/repository-stream'
import { fetchRepositorySnapshot } from '../src/github/client'
import type { GraphQlEnvelope } from '../src/github/transport'
import type { HostMessage, WebviewMessage } from '../src/platform/protocol'
import { issueNode, repository, repositoryPage } from '../tests/github-client-fixtures'
import { captureBrowserErrors, expectNoAccessibilityViolations } from './support'

type Request = Exclude<WebviewMessage, { type: 'save-file' | 'repository-changed' }>
type RequestOf<T extends Request['type']> = Extract<Request, { type: T }>

const postedMessages = (page: Page): Promise<WebviewMessage[]> =>
  page.evaluate(() => window.issueAtlasHost.posted)

const pendingRequest = (messages: readonly WebviewMessage[], type: Request['type']) => {
  const cancelled = new Set(
    messages.flatMap((message) => (message.type === 'cancel' ? [message.requestId] : [])),
  )
  return messages
    .filter(
      (message): message is Request =>
        message.type === type && !cancelled.has((message as Request).requestId),
    )
    .at(-1)
}

/**
 * Resolves the newest request of `type` that the viewer has not cancelled. React StrictMode runs
 * effects twice in development, so the first request of an effect is cancelled immediately.
 */
const activeRequest = async <T extends Request['type']>(
  page: Page,
  type: T,
  after = 0,
): Promise<RequestOf<T>> => {
  const find = async () => pendingRequest((await postedMessages(page)).slice(after), type)
  await expect.poll(async () => (await find()) !== undefined).toBe(true)
  return (await find()) as RequestOf<T>
}

const savedFile = async (page: Page) => {
  const find = async () =>
    (await postedMessages(page)).find(
      (message): message is Extract<WebviewMessage, { type: 'save-file' }> =>
        message.type === 'save-file',
    )
  await expect.poll(async () => (await find()) !== undefined).toBe(true)
  const message = await find()
  if (message === undefined) throw new Error('The viewer did not request a file save.')
  return message.file
}

const deliver = (page: Page, messages: readonly HostMessage[]): Promise<void> =>
  page.evaluate((items) => {
    for (const data of items) window.dispatchEvent(new MessageEvent('message', { data }))
  }, messages)

/** Produces exactly what the extension host streams for a two-page repository. */
const repositoryMessages = async (requestId: number): Promise<HostMessage[]> => {
  const pages: GraphQlEnvelope[] = [
    repositoryPage({
      nodes: [issueNode(1)],
      totalCount: 2,
      hasNextPage: true,
      endCursor: 'cursor-1',
    }),
    repositoryPage({ nodes: [issueNode(2)], totalCount: 2 }),
  ]
  const messages: HostMessage[] = []
  await fetchRepositorySnapshot(
    repository,
    async () => pages.shift() ?? { errors: [{ message: 'No more pages.' }] },
    repositoryPageMessages(requestId, (message) => messages.push(message)),
  )
  return [...messages, { type: 'repository-loaded', requestId }]
}

test('runs the viewer inside a VS Code webview without a token', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page)
  await page.goto('/e2e/vscode-webview.html')

  const load = await activeRequest(page, 'load-repository')
  expect(load.repository).toBe('octo-org/roadmap')
  await deliver(page, await repositoryMessages(load.requestId))

  const dialog = page.getByRole('dialog', { name: 'Open an issue dependency graph' })
  await expect(dialog).toBeHidden()
  await expect(page.locator('.source-badge')).toHaveText('Live')
  await expect(page.getByRole('link', { name: 'roadmap', exact: true })).toBeVisible()
  await expect(page.locator('.graph-canvas canvas').first()).toBeAttached()
  await expect
    .poll(() => page.evaluate(() => window.issueAtlasHost.state))
    .toEqual({ repository: 'octo-org/roadmap' })

  const sent = (await postedMessages(page)).length
  await page.getByRole('button', { name: /Issue 2 #2/ }).click()
  const body = await activeRequest(page, 'load-issue-body', sent)
  expect(body).toMatchObject({ repository: 'octo-org/roadmap', number: 2 })
  await deliver(page, [
    { type: 'issue-body', requestId: body.requestId, body: 'Loaded through the extension host.' },
  ])
  await expect(page.getByText('Loaded through the extension host.')).toBeVisible()

  await page.getByRole('button', { name: 'Export' }).click()
  const exported = await savedFile(page)
  expect(exported).toMatchObject({
    name: 'roadmap-issue-dependencies.json',
    mimeType: 'application/json',
    encoding: 'utf8',
  })
  expect(JSON.parse(exported.data)).toMatchObject({ repository: { name: 'roadmap' } })

  await page.evaluate(() => {
    document.body.className = 'vscode-dark'
    document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark')
  })
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', 'dark')

  await page.getByRole('button', { name: 'Open repository' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Read-only GitHub token')).toHaveCount(0)
  await expect(dialog).toContainText('No token needed.')
  await expectNoAccessibilityViolations(page)

  const beforeRetry = (await postedMessages(page)).length
  await dialog.getByLabel('Repository').fill('octo-org/private')
  await dialog.getByRole('button', { name: 'Load repository' }).click()
  const retry = await activeRequest(page, 'load-repository', beforeRetry)
  expect(retry.repository).toBe('octo-org/private')
  await deliver(page, [
    {
      type: 'request-failed',
      requestId: retry.requestId,
      message: 'GitHub CLI is not signed in to github.com.',
    },
  ])
  await expect(dialog).toContainText('GitHub CLI is not signed in to github.com.')
  expect(browserErrors).toEqual([])
})
