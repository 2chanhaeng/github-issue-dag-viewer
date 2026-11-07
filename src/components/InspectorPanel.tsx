import type { GraphAnalysis, IssueRecord } from '../domain/types'
import { IssueInspector } from './IssueInspector'
import { SidePanel } from './SidePanel'

interface InspectorPanelProps {
  analysis: GraphAnalysis
  bodyLoading: boolean
  issue: IssueRecord | null
  open: boolean
  onClose: () => void
}

export const InspectorPanel = ({
  analysis,
  bodyLoading,
  issue,
  open,
  onClose,
}: InspectorPanelProps): React.JSX.Element => (
  <SidePanel
    as="div"
    className="inspector-container"
    id="issue-inspector"
    label="issue details"
    mobileOpen={open}
    side="end"
  >
    <IssueInspector analysis={analysis} bodyLoading={bodyLoading} issue={issue} onClose={onClose} />
  </SidePanel>
)
