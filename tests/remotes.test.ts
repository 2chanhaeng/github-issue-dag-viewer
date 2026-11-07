import { describe, expect, it } from 'vitest'
import { repositoryCandidates } from '../extension/src/remotes'

describe('repositoryCandidates', () => {
  it('lists upstream before origin and merges remotes for the same repository', () => {
    expect(
      repositoryCandidates([
        { name: 'origin', fetchUrl: 'git@github.com:fork-owner/viewer.git' },
        { name: 'mirror', fetchUrl: 'https://github.com/Octo-Org/Viewer' },
        { name: 'upstream', fetchUrl: 'ssh://git@github.com/octo-org/viewer.git' },
      ]),
    ).toEqual([
      { nameWithOwner: 'octo-org/viewer', remotes: ['upstream', 'mirror'] },
      { nameWithOwner: 'fork-owner/viewer', remotes: ['origin'] },
    ])
  })

  it('ignores remotes outside github.com and falls back to the push URL', () => {
    expect(
      repositoryCandidates([
        { name: 'origin', fetchUrl: 'https://gitlab.com/octo-org/viewer.git' },
        { name: 'deploy', pushUrl: 'https://github.com/octo-org/deploy.git' },
        { name: 'local', fetchUrl: '/srv/git/viewer.git' },
      ]),
    ).toEqual([{ nameWithOwner: 'octo-org/deploy', remotes: ['deploy'] }])
  })
})
