import path from 'node:path'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { MAX_TEST_TITLE_LENGTH, MAX_SPEC_PATH_LENGTH, MAX_SELECTOR_LENGTH } from './constants.js'

// M5: validate list_specs pattern to block directory traversal via glob
export const ListSpecsArgs = z.object({
  pattern: z
    .string()
    .describe('Relative glob pattern (default: **/*.cy.{ts,js,tsx,jsx})')
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
    .describe('Relative path to the spec file (from project root)')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' })
    .refine((p) => !path.isAbsolute(p), { message: 'must be a relative path' }),
})

export const GetLastRunArgs = z.object({
  failedOnly: z
    .boolean()
    .describe('When true, return only failed tests. Recommended to reduce sensitive data exposure (default: false)')
    .optional(),
})

export const GetScreenshotArgs = z.object({
  path: z
    .string()
    .min(1, 'path is required')
    .describe('Path to the screenshot file, absolute or relative to project root (from last run results)')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' }),
})

export const QueryDomArgs = z.object({
  spec: z.string().min(1, 'spec is required').max(MAX_SPEC_PATH_LENGTH, 'spec path too long')
    .describe('Relative spec path (e.g. "cypress/e2e/login.cy.ts")'),
  testTitle: z.string().min(1, 'testTitle is required').max(MAX_TEST_TITLE_LENGTH, 'testTitle too long')
    .describe('Full test title as returned by get_last_run (joined with " > ")'),
  selector: z.string().min(1, 'selector is required').max(MAX_SELECTOR_LENGTH, 'selector too long')
    .describe('CSS selector to query (e.g. ".error-message", "#submit-btn")'),
})

const ALLOWED_BROWSERS = ['chrome', 'firefox', 'electron', 'edge'] as const
export type CypressBrowser = (typeof ALLOWED_BROWSERS)[number]

export const RunSpecArgs = z.object({
  spec: z
    .string()
    .min(1, 'spec is required')
    .describe('Relative path to the spec file within the project (e.g. "cypress/e2e/login.cy.ts")')
    .refine((p) => !p.includes('..'), { message: 'must not contain ..' })
    .refine((p) => !path.isAbsolute(p), { message: 'must be a relative path' }),
  headed: z
    .boolean()
    .describe('Run with a visible browser window instead of headless (default: false)')
    .optional(),
  browser: z
    .enum(ALLOWED_BROWSERS)
    .describe('Browser to use (default: electron)')
    .optional(),
})

/** Convert a Zod schema to a JSON Schema object suitable for MCP inputSchema */
export function zodInputSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  return zodToJsonSchema(schema, { target: 'openApi3' })
}
