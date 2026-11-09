import { describe, expect, it } from 'vitest'
import { parseSearch, serializeSearch, topLevelTerms } from '../src/domain/search-syntax'

const roundTrip = (query: string): string => {
  const parsed = parseSearch(query)
  if (!parsed.ok || parsed.node === null) throw new Error(`Expected ${query} to parse.`)
  return serializeSearch(parsed.node)
}

describe('parseSearch', () => {
  it('reads quoted and comma-separated qualifier values', () => {
    expect(parseSearch('milestone:"DrFed 0.2"')).toEqual({
      ok: true,
      node: {
        kind: 'qualifier',
        key: 'milestone',
        value: 'DrFed 0.2',
        values: ['DrFed 0.2'],
        raw: 'milestone:"DrFed 0.2"',
      },
    })
    expect(parseSearch('Label:"bug","help wanted"')).toMatchObject({
      ok: true,
      node: { key: 'label', values: ['bug', 'help wanted'] },
    })
    expect(parseSearch('field."target date":>=2026-03-01')).toMatchObject({
      ok: true,
      node: { key: 'field."target date"', value: '>=2026-03-01' },
    })
  })

  it('binds AND tighter than OR and treats spaces as AND', () => {
    expect(roundTrip('is:closed is:open OR milestone:"DrFed 0.2"')).toBe(
      '(is:closed is:open) OR milestone:"DrFed 0.2"',
    )
    expect(roundTrip('a AND b OR c d')).toBe('(a b) OR (c d)')
    expect(roundTrip('(a OR b) c')).toBe('(a OR b) c')
  })

  it('excludes qualifiers with a minus but ignores a minus on plain text', () => {
    expect(parseSearch('-label:bug')).toMatchObject({
      ok: true,
      node: { kind: 'not', minus: true, child: { key: 'label' } },
    })
    expect(parseSearch('-graph')).toEqual({
      ok: true,
      node: { kind: 'text', value: 'graph', raw: 'graph' },
    })
    expect(roundTrip('NOT graph -label:bug')).toBe('NOT graph -label:bug')
    expect(roundTrip('NOT (a OR b)')).toBe('NOT (a OR b)')
  })

  it('keeps quoted phrases, including parentheses inside quotes, as one term', () => {
    expect(parseSearch('"critical (path)"')).toEqual({
      ok: true,
      node: { kind: 'text', value: 'critical (path)', raw: '"critical (path)"' },
    })
  })

  it('ignores dangling operators like GitHub and rejects unbalanced parentheses', () => {
    expect(roundTrip('is:open AND')).toBe('is:open')
    expect(roundTrip('OR is:open')).toBe('is:open')
    expect(parseSearch('is:open (')).toEqual({
      ok: false,
      error: 'Close every opening parenthesis.',
    })
    expect(parseSearch('is:open)')).toEqual({
      ok: false,
      error: 'Remove the unmatched closing parenthesis.',
    })
    expect(parseSearch('   ')).toEqual({ ok: true, node: null })
  })

  it('lists top-level terms for menu editing', () => {
    expect(topLevelTerms('is:issue (a OR b) state:open')?.map(serializeSearch)).toEqual([
      'is:issue',
      'a OR b',
      'state:open',
    ])
    expect(topLevelTerms('a OR b')?.map(serializeSearch)).toEqual(['a OR b'])
    expect(topLevelTerms('(a')).toBeNull()
  })
})
