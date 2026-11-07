import type { RepositoryLoadUpdate } from '../../src/domain/types'
import type { HostMessage } from '../../src/platform/protocol'

/**
 * Converts cumulative client snapshots into page deltas, so streaming a large repository sends
 * each issue to the webview once instead of resending every earlier page.
 */
export const repositoryPageMessages = (
  requestId: number,
  post: (message: HostMessage) => void,
): ((update: RepositoryLoadUpdate) => void) => {
  let sent = 0
  return ({ progress, snapshot: { issues, ...snapshot } }) => {
    post({ type: 'repository-page', requestId, progress, snapshot, issues: issues.slice(sent) })
    sent = issues.length
  }
}
