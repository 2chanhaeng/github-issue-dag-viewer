import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_BAR_CONTAINER,
  COMMANDS,
  REPOSITORIES_VIEW,
  repositoryInputError,
  repositoryItem,
} from '../extension/src/commands'

interface Manifest {
  contributes: {
    commands: { command: string }[]
    viewsContainers: { activitybar: { id: string; icon: string }[] }
    views: Record<string, { id: string; icon: string }[]>
    viewsWelcome: { view: string; contents: string }[]
    menus: Record<string, { command: string; when?: string }[]>
  }
}

const manifest = JSON.parse(readFileSync('extension/package.json', 'utf8')) as Manifest
const { contributes } = manifest
const contributed = new Set(contributes.commands.map(({ command }) => command))
const packaged = readFileSync('extension/.vscodeignore', 'utf8')

describe('VS Code manifest', () => {
  it('contributes every command the extension registers', () => {
    expect([...contributed].toSorted()).toEqual(Object.values(COMMANDS).toSorted())
  })

  it('references only contributed commands from menus and welcome content', () => {
    const menuCommands = Object.values(contributes.menus).flatMap((items) =>
      items.map(({ command }) => command),
    )
    const welcomeCommands = contributes.viewsWelcome.flatMap(({ contents }) =>
      [...contents.matchAll(/\(command:([\w.]+)\)/g)].map(([, command]) => command),
    )

    expect(welcomeCommands).toEqual([COMMANDS.openRepository, COMMANDS.openDemo])
    for (const command of [...menuCommands, ...welcomeCommands]) {
      expect(contributed).toContain(command)
    }
  })

  it('places the repository view in an Activity Bar container with a packaged icon', () => {
    const [container] = contributes.viewsContainers.activitybar
    const views = contributes.views[ACTIVITY_BAR_CONTAINER] ?? []

    expect(container?.id).toBe(ACTIVITY_BAR_CONTAINER)
    expect(views.map(({ id }) => id)).toEqual([REPOSITORIES_VIEW])
    expect(contributes.viewsWelcome.map(({ view }) => view)).toEqual([REPOSITORIES_VIEW])
    for (const icon of [container?.icon, ...views.map((view) => view.icon)]) {
      expect(existsSync(`extension/${icon}`)).toBe(true)
      expect(icon).toMatch(/^media\/[\w-]+\.svg$/)
    }
    expect(packaged.split('\n')).toContain('!media/*.svg')
  })
})

describe('repository commands', () => {
  it('opens the graph for a listed repository', () => {
    expect(
      repositoryItem({ nameWithOwner: 'octo-org/roadmap', remotes: ['upstream', 'origin'] }),
    ).toEqual({
      label: 'octo-org/roadmap',
      description: 'upstream, origin',
      tooltip: 'Open the issue dependency graph for octo-org/roadmap',
      command: {
        command: COMMANDS.openGraph,
        title: 'Open Issue Dependency Graph',
        arguments: ['octo-org/roadmap'],
      },
    })
  })

  it.each([
    ['octo-org/roadmap', undefined],
    ['https://github.com/octo-org/roadmap', undefined],
    ['', 'Enter a GitHub repository URL.'],
    ['https://gitlab.com/octo-org/roadmap', 'Only github.com repository URLs are supported.'],
  ])('validates %j', (value, error) => {
    expect(repositoryInputError(value)).toBe(error)
  })
})
