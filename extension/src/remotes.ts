import { parseRepositoryInput } from '../../src/github/parse-repository'

export interface GitRemote {
  readonly name: string
  readonly fetchUrl?: string | undefined
  readonly pushUrl?: string | undefined
}

export interface RepositoryCandidate {
  nameWithOwner: string
  remotes: readonly string[]
}

const SSH_URL_PREFIX = /^ssh:\/\/git@github\.com(?::\d+)?\//i
/**
 * The repository parser also accepts bare `owner/name` input, so only URL forms are passed to it;
 * otherwise a local path remote such as `/srv/git/viewer.git` would read as `srv/git`.
 */
const GITHUB_REMOTE_URL = /^(?:https?:\/\/github\.com\/|git@github\.com:)/i

const repositoryName = (url: string): string | null => {
  const normalized = url.trim().replace(SSH_URL_PREFIX, 'https://github.com/')
  if (!GITHUB_REMOTE_URL.test(normalized)) return null
  try {
    return parseRepositoryInput(normalized).nameWithOwner
  } catch {
    return null
  }
}

/** Forks usually keep issues in `upstream`, so it sorts before `origin` and other remotes. */
const REMOTE_PRIORITY: readonly string[] = ['upstream', 'origin']

const remoteRank = ({ name }: GitRemote): number => {
  const rank = REMOTE_PRIORITY.indexOf(name)
  return rank === -1 ? REMOTE_PRIORITY.length : rank
}

/** Lists the distinct github.com repositories referenced by workspace Git remotes. */
export const repositoryCandidates = (remotes: readonly GitRemote[]): RepositoryCandidate[] => {
  const grouped = new Map<string, { nameWithOwner: string; remotes: Set<string> }>()
  for (const remote of [...remotes].sort((left, right) => remoteRank(left) - remoteRank(right))) {
    const nameWithOwner = repositoryName(remote.fetchUrl ?? remote.pushUrl ?? '')
    if (nameWithOwner === null) continue
    const key = nameWithOwner.toLowerCase()
    const candidate = grouped.get(key) ?? { nameWithOwner, remotes: new Set<string>() }
    candidate.remotes.add(remote.name)
    grouped.set(key, candidate)
  }
  return [...grouped.values()].map(({ nameWithOwner, remotes: names }) => ({
    nameWithOwner,
    remotes: [...names],
  }))
}
