import path from 'node:path'
import { z } from 'zod'

// M5: validate list_specs pattern to block directory traversal via glob
export const ListSpecsArgs = z.object({
  pattern: z
    .string()
    .refine((p) => !p.includes('..'), { message: 'pattern must not contain ..' })
    .refine((p) => !path.isAbsolute(p), { message: 'pattern must be a relative path' })
    // Block brace expansion that could embed absolute paths: {**/*.cy.ts,/etc/passwd}
    .refine((p) => !p.includes('{'), { message: 'pattern must not contain brace expansion' })
    .optional(),
})

export const ReadSpecArgs = z.object({
  path: z
    .string()
    .min(1, 'path is required')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' })
    .refine((p) => !path.isAbsolute(p), { message: 'must be a relative path' }),
})

export const GetLastRunArgs = z.object({
  failedOnly: z.boolean().optional(),
})

export const GetScreenshotArgs = z.object({
  path: z
    .string()
    .min(1, 'path is required')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' }),
})

export const QueryDomArgs = z.object({
  spec: z.string().min(1, 'spec is required').max(2048, 'spec path too long'),
  testTitle: z.string().min(1, 'testTitle is required').max(500, 'testTitle too long'),
  selector: z.string().min(1, 'selector is required'),
})

const ALLOWED_BROWSERS = ['chrome', 'firefox', 'electron', 'edge'] as const
export type CypressBrowser = (typeof ALLOWED_BROWSERS)[number]

export const RunSpecArgs = z.object({
  spec: z
    .string()
    .min(1, 'spec is required')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' })
    .refine((p) => !path.isAbsolute(p), { message: 'must be a relative path' }),
  headed: z.boolean().optional(),
  browser: z
    .enum(ALLOWED_BROWSERS)
    .optional(),
})
