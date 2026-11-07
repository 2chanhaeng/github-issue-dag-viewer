import { SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react'
import { IconButton } from '@primer/react'
import { type ReactNode, useState } from 'react'

interface SidePanelProps {
  as: 'aside' | 'div'
  children: ReactNode
  className: string
  id: string
  label: string
  mobileOpen: boolean
  side: 'start' | 'end'
}

const negate = (value: boolean): boolean => !value

const panelClassName = (className: string, mobileOpen: boolean, collapsed: boolean): string =>
  [
    className,
    ...(mobileOpen ? ['mobile-panel-open'] : []),
    ...(collapsed ? ['panel-collapsed'] : []),
  ].join(' ')

export const SidePanel = ({
  as: Element,
  children,
  className,
  id,
  label,
  mobileOpen,
  side,
}: SidePanelProps): React.JSX.Element => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Element className={panelClassName(className, mobileOpen, collapsed)} id={id}>
      <div className={`panel-toggle panel-toggle-${side}`}>
        <IconButton
          aria-controls={id}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          icon={collapsed ? SidebarExpandIcon : SidebarCollapseIcon}
          onClick={() => setCollapsed(negate)}
          size="small"
          tooltipDirection={side === 'start' ? 'e' : 'w'}
          variant="invisible"
        />
      </div>
      {children}
    </Element>
  )
}
