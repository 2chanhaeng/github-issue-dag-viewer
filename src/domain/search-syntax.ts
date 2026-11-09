/**
 * GitHub issue search syntax: implicit and explicit `AND`, `OR`, `NOT`, parentheses, `-` exclusion,
 * quoted values, and comma-separated qualifier values. `AND` binds tighter than `OR`, as on GitHub.
 */

const TOKEN_PATTERN = /[()]|(?:[^\s()"]|"[^"]*"?)+/g
const COMMA_SEPARATED_PATTERN = /(?:[^,"]|"[^"]*"?)+/g
const QUALIFIER_PATTERN = /^(field\.(?:"[^"]*"|[^\s:"]+)|[a-z][\w-]*):(.+)$/is
const OPERATORS: ReadonlySet<string> = new Set(['AND', 'OR', 'NOT'])

export interface QualifierTerm {
  kind: 'qualifier'
  /** Lower-case qualifier name, such as `label` or `field."target date"`. */
  key: string
  /** The whole value without quotation marks. */
  value: string
  /** Comma-separated values without quotation marks. */
  values: readonly string[]
  /** The term as written, without a leading `-`. */
  raw: string
}

export interface TextTerm {
  kind: 'text'
  value: string
  raw: string
}

export type SearchTerm = QualifierTerm | TextTerm

export type SearchNode =
  | SearchTerm
  | { kind: 'not'; child: SearchNode; minus: boolean }
  | { kind: 'and' | 'or'; children: readonly SearchNode[] }

export type ParsedSearch = { ok: true; node: SearchNode | null } | { ok: false; error: string }

type Operator = 'AND' | 'OR' | 'NOT'

type Token = { kind: 'open' } | { kind: 'close' } | { kind: 'operator'; operator: Operator }
type WordToken = { kind: 'word'; text: string }

interface Parsed {
  node: SearchNode | null
  next: number
}

class SearchSyntaxError extends Error {}

const isOperator = (value: string): value is Operator => OPERATORS.has(value)

const toToken = (text: string): Token | WordToken => {
  if (text === '(') return { kind: 'open' }
  if (text === ')') return { kind: 'close' }
  return isOperator(text) ? { kind: 'operator', operator: text } : { kind: 'word', text }
}

const tokenize = (query: string): (Token | WordToken)[] =>
  (query.match(TOKEN_PATTERN) ?? []).map(toToken)

const unquote = (value: string): string => value.replaceAll('"', '')

const operatorAt = (tokens: readonly (Token | WordToken)[], index: number): Operator | null => {
  const token = tokens[index]
  return token?.kind === 'operator' ? token.operator : null
}

const combine = (kind: 'and' | 'or', nodes: readonly SearchNode[]): SearchNode | null => {
  if (nodes.length <= 1) return nodes[0] ?? null
  return { kind, children: nodes }
}

const qualifierTerm = (key: string, rawValue: string, raw: string): QualifierTerm => ({
  kind: 'qualifier',
  key: key.toLocaleLowerCase(),
  value: unquote(rawValue),
  values: (rawValue.match(COMMA_SEPARATED_PATTERN) ?? []).map(unquote),
  raw,
})

/** GitHub ignores a leading `-` on plain text; only qualifiers can be excluded that way. */
const parseTerm = (word: string): SearchNode | null => {
  const minus = word.length > 1 && word.startsWith('-')
  const body = minus ? word.slice(1) : word
  const match = body.match(QUALIFIER_PATTERN)
  if (match === null) {
    const value = unquote(body).trim()
    return value.length === 0 ? null : { kind: 'text', value, raw: body }
  }
  const term = qualifierTerm(match[1] ?? '', match[2] ?? '', body)
  return minus ? { kind: 'not', child: term, minus: true } : term
}

const parseUnary = (tokens: readonly (Token | WordToken)[], start: number): Parsed => {
  const token = tokens[start]
  if (token?.kind === 'operator' && token.operator === 'NOT') {
    const { node, next } = parseUnary(tokens, start + 1)
    return { node: node === null ? null : { kind: 'not', child: node, minus: false }, next }
  }
  if (token?.kind === 'open') {
    const { node, next } = parseOr(tokens, start + 1)
    if (tokens[next]?.kind !== 'close') {
      throw new SearchSyntaxError('Close every opening parenthesis.')
    }
    return { node, next: next + 1 }
  }
  if (token?.kind === 'word') return { node: parseTerm(token.text), next: start + 1 }
  return { node: null, next: start }
}

/** Dangling `AND` and `OR` operators are ignored, matching GitHub. */
const parseAnd = (tokens: readonly (Token | WordToken)[], start: number): Parsed => {
  const terms: SearchNode[] = []
  let index = start
  while (
    index < tokens.length &&
    tokens[index]?.kind !== 'close' &&
    operatorAt(tokens, index) !== 'OR'
  ) {
    if (operatorAt(tokens, index) === 'AND') {
      index += 1
      continue
    }
    const { node, next } = parseUnary(tokens, index)
    if (node !== null) terms.push(node)
    index = next
  }
  return { node: combine('and', terms), next: index }
}

const parseOr = (tokens: readonly (Token | WordToken)[], start: number): Parsed => {
  const branches: SearchNode[] = []
  let index = start
  for (;;) {
    const { node, next } = parseAnd(tokens, index)
    if (node !== null) branches.push(node)
    index = next
    if (operatorAt(tokens, index) !== 'OR') break
    index += 1
  }
  return { node: combine('or', branches), next: index }
}

export const parseSearch = (query: string): ParsedSearch => {
  const tokens = tokenize(query)
  try {
    const { node, next } = parseOr(tokens, 0)
    if (next < tokens.length) {
      return { ok: false, error: 'Remove the unmatched closing parenthesis.' }
    }
    return { ok: true, node }
  } catch (error) {
    if (error instanceof SearchSyntaxError) return { ok: false, error: error.message }
    throw error
  }
}

/** Serializes a node so that it can be combined with sibling terms without changing its meaning. */
export const serializeOperand = (node: SearchNode): string => {
  const text = serializeSearch(node)
  return node.kind === 'or' ? `(${text})` : text
}

export const serializeSearch = (node: SearchNode): string => {
  switch (node.kind) {
    case 'qualifier':
    case 'text':
      return node.raw
    case 'not':
      return node.minus && node.child.kind === 'qualifier'
        ? `-${node.child.raw}`
        : `NOT ${node.child.kind === 'and' ? `(${serializeSearch(node.child)})` : serializeOperand(node.child)}`
    case 'and':
      return node.children.map(serializeOperand).join(' ')
    case 'or':
      return node.children
        .map((child) =>
          child.kind === 'and' ? `(${serializeSearch(child)})` : serializeSearch(child),
        )
        .join(' OR ')
  }
}

/** The terms joined by the top-level implicit `AND`, or null when the query does not parse. */
export const topLevelTerms = (query: string): readonly SearchNode[] | null => {
  const parsed = parseSearch(query)
  if (!parsed.ok) return null
  if (parsed.node === null) return []
  return parsed.node.kind === 'and' ? parsed.node.children : [parsed.node]
}
