import type { GraphAnalysis, GraphFilters } from '../domain/types'
import { FilterPanel } from './FilterPanel'
import { IssueList } from './IssueList'
import { SidePanel } from './SidePanel'

interface IssueRailProps {
  analysis: GraphAnalysis
  filters: GraphFilters
  issueKeys: ReadonlySet<string>
  labels: readonly string[]
  open: boolean
  selectedKey: string | null
  onClose: () => void
  onFiltersChange: (filters: GraphFilters) => void
  onSelect: (key: string) => void
}

export const IssueRail = ({
  analysis,
  filters,
  issueKeys,
  labels,
  open,
  selectedKey,
  onClose,
  onFiltersChange,
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
      filters={filters}
      labels={labels}
      onChange={onFiltersChange}
      onClose={onClose}
      resultCount={issueKeys.size}
    />
    <IssueList
      analysis={analysis}
      issueKeys={issueKeys}
      onSelect={onSelect}
      selectedKey={selectedKey}
    />
  </SidePanel>
)
