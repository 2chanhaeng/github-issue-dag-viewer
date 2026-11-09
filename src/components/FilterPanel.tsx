import { FilterIcon, SearchIcon, TriangleDownIcon, XIcon } from '@primer/octicons-react'
import { ActionList, ActionMenu, Button, Checkbox, FormControl, TextInput } from '@primer/react'
import { useEffect, useState } from 'react'
import {
  applyMenuSelections,
  DEFAULT_QUERY,
  hasActiveQuery,
  type MenuSelections,
  menuSelections,
} from '../domain/filter-menus'
import type { IssueStateFilter, ReadinessFilter } from '../domain/types'
import type { RemoteSearchState } from '../hooks/use-remote-search'

const QUERY_DEBOUNCE_MILLISECONDS = 200
const STATUS_ID = 'filter-status'

interface FilterPanelProps {
  query: string
  labels: readonly string[]
  resultCount: number
  searchError: string | null
  remoteSearch: RemoteSearchState
  onQueryChange: (query: string) => void
  onClose: () => void
}

interface StatusMessage {
  tone: 'danger' | 'attention' | 'muted'
  text: string
}

const updateSet = (values: ReadonlySet<string>, value: string): Set<string> => {
  const next = new Set(values)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

const stateOptions: readonly { value: IssueStateFilter; label: string }[] = [
  { value: 'all', label: 'All states' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

const readinessOptions: readonly { value: ReadinessFilter; label: string }[] = [
  { value: 'all', label: 'All readiness' },
  { value: 'ready', label: 'Ready' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cyclic', label: 'In a cycle' },
]

const statusMessages = (searchError: string | null, remote: RemoteSearchState): StatusMessage[] => [
  ...(searchError === null ? [] : [{ tone: 'danger' as const, text: searchError }]),
  ...(remote.pending ? [{ tone: 'muted' as const, text: 'Searching GitHub…' }] : []),
  ...remote.failures.map(({ query, message }) => ({
    tone: 'danger' as const,
    text: `GitHub could not search ${query}: ${message}`,
  })),
  ...remote.truncated.map(({ query, total, returned }) => ({
    tone: 'attention' as const,
    text: `GitHub returned only ${returned.toLocaleString()} of ${total.toLocaleString()} matches for ${query}.`,
  })),
  ...(remote.unavailable.length === 0
    ? []
    : [
        {
          tone: 'attention' as const,
          text: `Open a GitHub repository to search ${remote.unavailable.join(', ')}; demo data cannot answer it.`,
        },
      ]),
]

export const FilterPanel = ({
  query,
  labels,
  resultCount,
  searchError,
  remoteSearch,
  onQueryChange,
  onClose,
}: FilterPanelProps): React.JSX.Element => {
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelSearch, setLabelSearch] = useState('')
  const [queryDraft, setQueryDraft] = useState(query)
  const selections = menuSelections(queryDraft)
  const messages = statusMessages(searchError, remoteSearch)

  useEffect(() => setQueryDraft(query), [query])

  useEffect(() => {
    if (queryDraft === query) return
    const timeout = window.setTimeout(() => onQueryChange(queryDraft), QUERY_DEBOUNCE_MILLISECONDS)
    return () => window.clearTimeout(timeout)
  }, [query, onQueryChange, queryDraft])

  const commit = (next: string): void => {
    setQueryDraft(next)
    onQueryChange(next)
  }

  const applySelections = (next: MenuSelections): void =>
    commit(applyMenuSelections(queryDraft, next))

  const visibleLabels = labels.filter((label) =>
    label.toLocaleLowerCase().includes(labelSearch.toLocaleLowerCase()),
  )

  return (
    <section className="filter-panel" aria-labelledby="filter-heading">
      <div className="panel-heading-row">
        <h2 id="filter-heading">
          <FilterIcon size={16} /> Issues
        </h2>
        <span className="result-count">{resultCount.toLocaleString()}</span>
        <button
          aria-label="Close issue list"
          className="mobile-panel-close"
          onClick={onClose}
          type="button"
        >
          <XIcon size={16} />
        </button>
      </div>

      <TextInput
        aria-describedby={messages.length > 0 ? STATUS_ID : undefined}
        aria-invalid={searchError === null ? undefined : true}
        aria-label="Search issues"
        block
        className="github-filter-input"
        leadingVisual={SearchIcon}
        onChange={(event) => setQueryDraft(event.currentTarget.value)}
        placeholder="Search or filter issues"
        value={queryDraft}
      />

      <ul aria-live="polite" className="filter-status" id={STATUS_ID}>
        {messages.map(({ tone, text }) => (
          <li className={`filter-status-${tone}`} key={`${tone}:${text}`}>
            {text}
          </li>
        ))}
      </ul>

      <div className="filter-menu-row">
        <ActionMenu>
          <ActionMenu.Button size="small" trailingVisual={TriangleDownIcon}>
            {selections.state === 'all' ? 'State' : `State: ${selections.state}`}
          </ActionMenu.Button>
          <ActionMenu.Overlay align="start" width="small">
            <ActionList selectionVariant="single">
              <ActionList.Group>
                <ActionList.GroupHeading>Filter by state</ActionList.GroupHeading>
                {stateOptions.map((option) => (
                  <ActionList.Item
                    key={option.value}
                    onSelect={() => applySelections({ ...selections, state: option.value })}
                    selected={selections.state === option.value}
                  >
                    {option.label}
                  </ActionList.Item>
                ))}
              </ActionList.Group>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        <ActionMenu>
          <ActionMenu.Button size="small" trailingVisual={TriangleDownIcon}>
            {selections.readiness === 'all' ? 'Readiness' : `Readiness: ${selections.readiness}`}
          </ActionMenu.Button>
          <ActionMenu.Overlay align="start" width="small">
            <ActionList selectionVariant="single">
              <ActionList.Group>
                <ActionList.GroupHeading>Filter by readiness</ActionList.GroupHeading>
                {readinessOptions.map((option) => (
                  <ActionList.Item
                    key={option.value}
                    onSelect={() => applySelections({ ...selections, readiness: option.value })}
                    selected={selections.readiness === option.value}
                  >
                    {option.label}
                  </ActionList.Item>
                ))}
              </ActionList.Group>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        <ActionMenu
          onOpenChange={(open) => {
            setLabelsOpen(open)
            if (!open) setLabelSearch('')
          }}
          open={labelsOpen}
        >
          <ActionMenu.Button
            {...(selections.labels.size === 0 ? {} : { count: selections.labels.size })}
            size="small"
            trailingVisual={TriangleDownIcon}
          >
            Labels
          </ActionMenu.Button>
          <ActionMenu.Overlay align="start" width="medium">
            <div className="label-menu">
              <strong>Filter by label</strong>
              <TextInput
                aria-label="Filter labels"
                block
                leadingVisual={SearchIcon}
                onChange={(event) => setLabelSearch(event.currentTarget.value)}
                placeholder="Filter labels"
                value={labelSearch}
              />
              <div className="label-menu-options">
                <ActionList selectionVariant="multiple">
                  {visibleLabels.map((label) => (
                    <ActionList.Item
                      key={label}
                      onSelect={(event) => {
                        event.preventDefault()
                        applySelections({
                          ...selections,
                          labels: updateSet(selections.labels, label),
                        })
                      }}
                      selected={selections.labels.has(label)}
                    >
                      {label}
                    </ActionList.Item>
                  ))}
                  {visibleLabels.length === 0 ? (
                    <ActionList.Item disabled>No labels found</ActionList.Item>
                  ) : null}
                </ActionList>
              </div>
            </div>
          </ActionMenu.Overlay>
        </ActionMenu>
      </div>

      <FormControl className="external-toggle">
        <Checkbox
          checked={selections.showExternal}
          onChange={(event) =>
            applySelections({ ...selections, showExternal: event.target.checked })
          }
        />
        <FormControl.Label>Show cross-repository issues</FormControl.Label>
      </FormControl>

      {hasActiveQuery(query) ? (
        <Button
          block
          leadingVisual={XIcon}
          onClick={() => commit(DEFAULT_QUERY)}
          size="small"
          variant="invisible"
        >
          Clear filters
        </Button>
      ) : null}
    </section>
  )
}
