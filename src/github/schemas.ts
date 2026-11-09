import { z } from 'zod'

const actorSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().url(),
  url: z.string().url(),
})

const dependencySchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['OPEN', 'CLOSED']),
  title: z.string(),
  url: z.string().url(),
  repository: z.object({ nameWithOwner: z.string() }),
})

const dependencyConnectionSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  nodes: z.array(dependencySchema),
})

const countSchema = z.object({ totalCount: z.number().int().nonnegative() })

const issueReferenceSchema = z.object({
  number: z.number().int().positive(),
  repository: z.object({ nameWithOwner: z.string() }),
})

const issueSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED']),
  stateReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  author: actorSchema.nullable(),
  assignees: z.object({ nodes: z.array(actorSchema) }),
  labels: z.object({
    nodes: z.array(
      z.object({
        name: z.string(),
        color: z.string(),
        description: z.string().nullable(),
      }),
    ),
  }),
  milestone: z.object({ title: z.string(), url: z.string().url() }).nullable(),
  issueType: z.object({ name: z.string() }).nullable(),
  locked: z.boolean(),
  comments: countSchema,
  reactions: countSchema,
  reactionGroups: z.array(z.object({ content: z.string(), reactors: countSchema })).nullable(),
  parent: issueReferenceSchema.nullable(),
  subIssues: z.object({ nodes: z.array(issueReferenceSchema) }),
  blockedBy: dependencyConnectionSchema,
  blocking: dependencyConnectionSchema,
})

export const repositoryPageSchema = z.object({
  repository: z
    .object({
      nameWithOwner: z.string(),
      url: z.string().url(),
      description: z.string().nullable(),
      isPrivate: z.boolean(),
      isArchived: z.boolean(),
      primaryLanguage: z.object({ name: z.string() }).nullable(),
      issues: z.object({
        totalCount: z.number().int().nonnegative(),
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
        nodes: z.array(issueSchema),
      }),
    })
    .nullable(),
  /** Only `@me` needs the viewer, so a response without it still loads. */
  viewer: z.object({ login: z.string() }).nullish(),
  rateLimit: z.object({
    cost: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.string(),
  }),
})

/** Search nodes are null or empty objects for results that are not issues. */
export const issueSearchSchema = z.object({
  search: z.object({
    issueCount: z.number().int().nonnegative(),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(issueReferenceSchema.partial().nullable()),
  }),
})

export const issueDetailsSchema = z.object({
  repository: z
    .object({
      issue: z
        .object({
          number: z.number().int().positive(),
          body: z.string(),
          updatedAt: z.string(),
        })
        .nullable(),
    })
    .nullable(),
  rateLimit: z.object({
    cost: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.string(),
  }),
})

export type RepositoryPageResponse = z.infer<typeof repositoryPageSchema>
export type IssueSearchResponse = z.infer<typeof issueSearchSchema>
export type IssueDetailsResponse = z.infer<typeof issueDetailsSchema>
