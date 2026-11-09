import { describe, expect, it } from 'vitest'
import {
  applyMenuSelections,
  hasActiveQuery,
  type MenuSelections,
  menuSelections,
} from '../src/domain/filter-menus'

const NO_SELECTIONS: MenuSelections = {
  state: 'all',
  readiness: 'all',
  labels: new Set(),
  showExternal: true,
}

describe('filter menus', () => {
  it('reads menu selections from top-level terms only', () => {
    expect(
      menuSelections('is:issue is:open is:ready label:"area:ui","area:api" -is:external'),
    ).toEqual({
      state: 'open',
      readiness: 'ready',
      labels: new Set(['area:ui', 'area:api']),
      showExternal: false,
    })
    expect(menuSelections('state:closed OR label:bug')).toEqual(NO_SELECTIONS)
  })

  it('rewrites menu terms and keeps the rest of the query', () => {
    expect(
      applyMenuSelections('is:issue milestone:"DrFed 0.2" state:closed (a OR b)', {
        ...NO_SELECTIONS,
        state: 'open',
        labels: new Set(['area:ui', 'area:api']),
      }),
    ).toBe('is:issue milestone:"DrFed 0.2" (a OR b) state:open label:"area:api","area:ui"')
    expect(
      applyMenuSelections('is:issue state:closed', {
        ...NO_SELECTIONS,
        state: 'closed',
        labels: new Set(['area:docs']),
      }),
    ).toBe('is:issue state:closed label:"area:docs"')
  })

  it('appends menu terms to a query that does not parse', () => {
    expect(applyMenuSelections('(label:bug', { ...NO_SELECTIONS, showExternal: false })).toBe(
      '(label:bug -is:external',
    )
  })

  it('treats the default query as inactive', () => {
    expect(hasActiveQuery(' is:issue ')).toBe(false)
    expect(hasActiveQuery('is:issue milestone:"DrFed 0.2"')).toBe(true)
  })
})
