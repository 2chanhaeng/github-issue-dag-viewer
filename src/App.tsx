import { SyncIcon } from '@primer/octicons-react'
import { BaseStyles, Spinner, ThemeProvider } from '@primer/react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { GraphArea } from './components/GraphArea'
import type { LayoutDirection } from './components/GraphCanvas'
import { InspectorPanel } from './components/InspectorPanel'
import { IssueRail } from './components/IssueRail'
import { RepositoryDialog } from './components/RepositoryDialog'
import { RepositoryLoadProgress } from './components/RepositoryLoadProgress'
import { StatsBar } from './components/StatsBar'
import { demoSnapshot } from './demo/demo-data'
import { availableLabels, filterIssueKeys } from './domain/filters'
import { analyzeGraph } from './domain/graph'
import type { GraphAnalysis, GraphFilters, LoadProgress, RepositorySnapshot } from './domain/types'
import { parseRepositoryInput } from './github/parse-repository'
import { useColorMode } from './hooks/use-color-mode'
import { useLazyIssueBody } from './hooks/use-issue-body'
import type { ExportFile, IssueSource, ViewerPlatform } from './platform/types'
import './styles/base.css'
import './styles/shell.css'
import './styles/details.css'
import './styles/graph.css'
import './styles/responsive.css'

const initialFilters = (): GraphFilters => ({
  query: 'is:issue',
  state: 'all',
  readiness: 'all',
  labels: new Set(),
  showExternal: true,
})

const jsonExportFile = (snapshot: RepositorySnapshot, keys: ReadonlySet<string>): ExportFile => ({
  name: `${snapshot.repository.name}-issue-dependencies.json`,
  mimeType: 'application/json',
  encoding: 'utf8',
  data: JSON.stringify(
    {
      repository: snapshot.repository,
      fetchedAt: snapshot.fetchedAt,
      issues: snapshot.issues.filter(({ key }) => keys.has(key)),
    },
    null,
    2,
  ),
})

const selectInitialIssue = (snapshot: RepositorySnapshot): string | null => {
  const analysis = analyzeGraph(snapshot.issues)
  return (
    [...analysis.ready][0] ?? snapshot.issues.find(({ state }) => state === 'OPEN')?.key ?? null
  )
}

const graphWarningFor = (analysis: GraphAnalysis, snapshot: RepositorySnapshot): string =>
  [
    analysis.cycles.length > 0
      ? `${analysis.cycles.length} dependency cycle${analysis.cycles.length === 1 ? '' : 's'} detected.`
      : null,
    snapshot.issues.some(({ dependencyDataTruncated }) => dependencyDataTruncated)
      ? 'At least one issue has more than 100 dependency relationships; that node is partial.'
      : null,
  ]
    .filter((message): message is string => message !== null)
    .join(' ')

const RepositoryLoadOverlay = ({ progress }: { progress: LoadProgress }): React.JSX.Element => (
  <div className="load-overlay">
    <Spinner size="medium" />
    <div className="load-overlay-content">
      <strong>Reading issue dependencies</strong>
      <RepositoryLoadProgress progress={progress} />
    </div>
  </div>
)

export default function App({ platform }: { platform: ViewerPlatform }): React.JSX.Element {
  const { initialRepository } = platform
  const connectsOnStart = platform.credentials.kind === 'host' && initialRepository.length > 0
  const colorMode = useColorMode(platform.colorModes)
  const [snapshot, setSnapshot] = useState<RepositorySnapshot>(demoSnapshot)
  const [source, setSource] = useState<'demo' | 'github'>('demo')
  const [filters, setFilters] = useState<GraphFilters>(initialFilters)
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    selectInitialIssue(demoSnapshot),
  )
  const [direction, setDirection] = useState<LayoutDirection>('LR')
  const [dialogOpen, setDialogOpen] = useState(initialRepository.length > 0 && !connectsOnStart)
  const [loading, setLoading] = useState(false)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sourceRef = useRef<IssueSource | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)

  const analysis = useMemo(() => analyzeGraph(snapshot.issues), [snapshot.issues])
  const visibleKeys = useMemo(() => filterIssueKeys(analysis, filters), [analysis, filters])
  const labels = useMemo(() => availableLabels(analysis), [analysis])
  const selectedIssue = selectedKey === null ? null : (analysis.nodes.get(selectedKey) ?? null)
  const selectIssue = (key: string): void => {
    setSelectedKey(key)
    setInspectorOpen(true)
  }

  useEffect(() => {
    if (selectedKey !== null && visibleKeys.has(selectedKey)) return
    setSelectedKey([...visibleKeys][0] ?? null)
  }, [selectedKey, visibleKeys])

  const storeIssueBody = useCallback(
    (key: string, body: string) =>
      setSnapshot((current) => ({
        ...current,
        issues: current.issues.map((issue) => (issue.key === key ? { ...issue, body } : issue)),
      })),
    [],
  )
  const bodyLoading = useLazyIssueBody({
    enabled: source === 'github' && !loading,
    issue: selectedIssue,
    repository: snapshot.repository,
    sourceRef,
    onBody: storeIssueBody,
    onError: setError,
  })

  const loadRepository = useCallback(
    async (input: string, token: string): Promise<void> => {
      let controller: AbortController | null = null
      try {
        const repository = parseRepositoryInput(input)
        const normalizedToken = token.trim()
        if (platform.credentials.kind === 'token' && normalizedToken.length === 0) {
          throw new Error('A GitHub token is required for GraphQL.')
        }
        loadAbortRef.current?.abort()
        controller = new AbortController()
        loadAbortRef.current = controller
        const issueSource = platform.openSource(normalizedToken)
        sourceRef.current = issueSource
        setLoading(true)
        setError(null)
        setProgress({ loaded: 0, total: 0 })
        let published = false
        const loaded = await issueSource.loadRepository(
          repository,
          ({ progress: nextProgress, snapshot: partialSnapshot }) => {
            setProgress(nextProgress)
            if (published) {
              startTransition(() => setSnapshot(partialSnapshot))
              return
            }

            published = true
            setSnapshot(partialSnapshot)
            setSource('github')
            setFilters(initialFilters())
            setSelectedKey(selectInitialIssue(partialSnapshot))
            setDialogOpen(false)
            platform.rememberRepository(partialSnapshot.repository.nameWithOwner)
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setSnapshot(loaded)
      } catch (reason) {
        if (controller?.signal.aborted) return
        sourceRef.current = null
        setError(reason instanceof Error ? reason.message : 'Unable to load repository.')
        setDialogOpen(true)
      } finally {
        if (controller === null || loadAbortRef.current === controller) {
          loadAbortRef.current = null
          setLoading(false)
          setProgress(null)
        }
      }
    },
    [platform],
  )

  useEffect(() => {
    if (connectsOnStart) void loadRepository(initialRepository, '')
  }, [connectsOnStart, initialRepository, loadRepository])

  const loadDemo = (): void => {
    loadAbortRef.current?.abort()
    sourceRef.current = null
    setSnapshot({ ...demoSnapshot, fetchedAt: new Date().toISOString() })
    setSource('demo')
    setFilters(initialFilters())
    setSelectedKey(selectInitialIssue(demoSnapshot))
    setDialogOpen(false)
    setError(null)
    platform.rememberRepository(null)
  }

  const graphWarning = loading ? '' : graphWarningFor(analysis, snapshot)

  return (
    <ThemeProvider
      colorMode={platform.colorModes.followsSystem ? 'auto' : colorMode}
      dayScheme="light"
      nightScheme="dark"
    >
      <BaseStyles className="app-root">
        <AppHeader
          loading={loading}
          onChangeRepository={() => setDialogOpen(true)}
          onExport={() => platform.saveFile(jsonExportFile(snapshot, visibleKeys))}
          repository={snapshot.repository.nameWithOwner}
          source={source}
        />
        <StatsBar stats={analysis.stats} />

        <main className="workspace">
          <IssueRail
            analysis={analysis}
            filters={filters}
            issueKeys={visibleKeys}
            labels={labels}
            onClose={() => setIssuesOpen(false)}
            onFiltersChange={setFilters}
            onSelect={selectIssue}
            open={issuesOpen}
            selectedKey={selectedKey}
          />
          <GraphArea
            analysis={analysis}
            colorMode={colorMode}
            direction={direction}
            issueKeys={visibleKeys}
            key={snapshot.fetchedAt}
            loadProgress={progress}
            onDirectionChange={setDirection}
            onOpenInspector={() => setInspectorOpen(true)}
            onOpenIssues={() => setIssuesOpen(true)}
            onSaveFile={platform.saveFile}
            onSelect={selectIssue}
            selectedKey={selectedKey}
            warning={graphWarning}
          />
          <InspectorPanel
            analysis={analysis}
            bodyLoading={bodyLoading}
            issue={selectedIssue}
            onClose={() => setInspectorOpen(false)}
            open={inspectorOpen}
          />
        </main>

        {loading && progress !== null ? <RepositoryLoadOverlay progress={progress} /> : null}

        <RepositoryDialog
          credentials={platform.credentials}
          error={error}
          initialRepository={initialRepository || snapshot.repository.url}
          loading={loading}
          onClose={() => setDialogOpen(false)}
          onConnect={(repository, token) => void loadRepository(repository, token)}
          onDemo={loadDemo}
          open={dialogOpen}
          progress={progress}
        />
        <div aria-live="polite" className="sr-only">
          {loading ? (
            <>
              <SyncIcon /> Loading repository
            </>
          ) : null}
        </div>
      </BaseStyles>
    </ThemeProvider>
  )
}
