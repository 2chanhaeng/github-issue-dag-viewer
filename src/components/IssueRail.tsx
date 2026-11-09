import type { GraphAnalysis } from '../domain/types'
import type { IssueSearch } from '../hooks/use-issue-search'
import { FilterPanel } from './FilterPanel'
import { IssueList } from './IssueList'
import { SidePanel } from './SidePanel'

interface IssueRailProps {
  analysis: GraphAnalysis
  query: string
  search: IssueSearch
  labels: readonly string[]
  open: boolean
  selectedKey: string | null
  onClose: () => void
  onQueryChange: (query: string) => void
  onSelect: (key: string) => void
}

export const IssueRail = ({
  analysis,
  query,
  search,
  labels,
  open,
  selectedKey,
  onClose,
  onQueryChange,
  onSelect,
}: IssueRailProps): React.JSX.Element => (
  <SidePanel
    as="aside"
    className="issue-rail"
    id="issue-rail"
    label="issue list"
    mobileOpen={open}
    side="start"
  >
    <FilterPanel
      labels={labels}
      onClose={onClose}
      onQueryChange={onQueryChange}
      query={query}
      remoteSearch={search.remoteSearch}
      resultCount={search.visibleKeys.size}
      searchError={search.plan.error}
    />
    <IssueList
      analysis={analysis}
      issueKeys={search.visibleKeys}
      onSelect={onSelect}
      selectedKey={selectedKey}
      sort={search.plan.sort}
    />
  </SidePanel>
)
