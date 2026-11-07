import { z } from 'zod'
import { EXPORT_FILE_NAME_PATTERN, type WebviewMessage } from '../../src/platform/protocol'

/**
 * The webview renders repository-controlled Markdown, so the extension host treats every message
 * from it as untrusted input.
 */

const requestId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const repositoryName = z.string().min(1).max(256)

export const webviewMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load-repository'), requestId, repository: repositoryName }),
  z.object({
    type: z.literal('load-issue-body'),
    requestId,
    repository: repositoryName,
    number: z.number().int().positive(),
  }),
  z.object({ type: z.literal('cancel'), requestId }),
  z.object({
    type: z.literal('save-file'),
    file: z.object({
      name: z.string().regex(EXPORT_FILE_NAME_PATTERN),
      mimeType: z.string().max(100),
      encoding: z.enum(['utf8', 'base64']),
      data: z.string(),
    }),
  }),
  z.object({ type: z.literal('repository-changed'), repository: repositoryName.nullable() }),
]) satisfies z.ZodType<WebviewMessage>

export const parseWebviewMessage = (value: unknown): WebviewMessage | null => {
  const result = webviewMessageSchema.safeParse(value)
  return result.success ? result.data : null
}
