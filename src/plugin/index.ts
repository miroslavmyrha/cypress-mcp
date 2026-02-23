/// <reference types="cypress" />
import { constants, lstatSync, mkdirSync, openSync, closeSync, writeSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { specSlug, testFilename } from '../utils/slug.js'
import { redactSecrets } from '../utils/redact.js'
import { OUTPUT_DIR_NAME, SNAPSHOTS_SUBDIR, MAX_TEST_TITLE_LENGTH, MAX_MESSAGE_LENGTH, MAX_URL_LENGTH, MAX_COMMANDS_PER_TEST } from '../utils/constants.js'
import { getErrorMessage, getErrnoCode } from '../utils/errors.js'
import type { CommandEntry, NetworkError } from '../types.js'

// ─── Zod schema limits for mcpSaveTestLog task payload ──────────────────────
const MAX_COMMAND_NAME_LENGTH = 100
const MAX_HTTP_METHOD_LENGTH = 10
const MIN_HTTP_STATUS = 100
const MAX_HTTP_STATUS = 599
const MAX_DOM_SNAPSHOT_LENGTH = 200_000
const MAX_ERRORS_PER_TEST = 50

// H1: Zod schema for runtime validation of mcpSaveTestLog task payload.
// TypeScript interfaces provide zero runtime protection — any cy.task() caller can bypass them.
const CommandEntrySchema = z.object({
  name: z.string().max(MAX_COMMAND_NAME_LENGTH),
  message: z.string().max(MAX_MESSAGE_LENGTH),
})

const NetworkErrorSchema = z.object({
  method: z.string().max(MAX_HTTP_METHOD_LENGTH),
  url: z.string().max(MAX_URL_LENGTH),
  status: z.number().int().min(MIN_HTTP_STATUS).max(MAX_HTTP_STATUS),
})

const TestLogPayloadSchema = z.object({
  testTitle: z.string().max(MAX_TEST_TITLE_LENGTH),
  commands: z.array(CommandEntrySchema).max(MAX_COMMANDS_PER_TEST),
  // H1: server-side size cap — support/index.ts caps at 100KB but task callers can bypass it
  domSnapshot: z.string().max(MAX_DOM_SNAPSHOT_LENGTH).nullable(),
  consoleErrors: z.array(z.string().max(MAX_MESSAGE_LENGTH)).max(MAX_ERRORS_PER_TEST),
  networkErrors: z.array(NetworkErrorSchema).max(MAX_ERRORS_PER_TEST),
})

type TestLogPayload = z.infer<typeof TestLogPayloadSchema>

interface SpecResult {
  spec: string
  stats: {
    passes: number
    failures: number
    pending: number
    skipped: number
    duration: number
  }
  screenshots: string[]
  tests: Array<{
    title: string
    state: string
    duration: number
    error: string | null
    domSnapshotPath: string | null
    commands: CommandEntry[]
    consoleErrors: string[]
    networkErrors: NetworkError[]
  }>
}

interface RunData {
  timestamp: string
  specs: SpecResult[]
}

export interface McpPluginOptions {
  /** Include screenshot paths in output. Default: true */
  screenshots?: boolean
}

// Cap testLogs entries to prevent OOM via cy.task flood with unique testTitles
const MAX_TEST_LOG_ENTRIES = 500

// Fix #10: Refuse to write through symlinks — O_NOFOLLOW atomically rejects symlinks,
// closing the TOCTOU window that existed with the previous lstat + writeFileSync approach.
const O_NOFOLLOW = (constants as Record<string, number>).O_NOFOLLOW ?? 0

function safeWriteFileSync(filePath: string, content: string): void {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | O_NOFOLLOW
  let fd: number
  try {
    fd = openSync(filePath, flags, 0o644)
  } catch (err) {
    if (getErrnoCode(err) === 'ELOOP') {
      // O_NOFOLLOW rejected a symlink — this is expected and safe
      process.stderr.write(`[cypress-mcp] Refusing to write to symlink: ${filePath}\n`)
      return
    }
    throw err
  }
  try {
    writeSync(fd, content)
  } finally {
    closeSync(fd)
  }
}

function buildSpecResult(
  spec: Cypress.Spec,
  results: CypressCommandLine.RunResult,
  testLogs: Map<string, TestLogPayload>,
  options: McpPluginOptions,
  snapshotsDir: string,
): SpecResult {
  const tests = (results.tests ?? []).map((test: CypressCommandLine.TestResult) => {
    const titlePath = test.title.join(' > ')
    const logEntry = testLogs.get(titlePath)

    let domSnapshotPath: string | null = null
    if (logEntry?.domSnapshot) {
      // L8: catch snapshot write failures — disk full, permissions, etc.
      // Degrade gracefully: spec result is still written with domSnapshotPath: null
      try {
        const slug = specSlug(spec.relative)
        const specDir = path.join(snapshotsDir, slug)
        mkdirSync(specDir, { recursive: true })
        const filename = testFilename(titlePath)
        const snapshotFile = path.join(specDir, filename)
        safeWriteFileSync(snapshotFile, logEntry.domSnapshot)
        // Store as relative path from .cypress-mcp/ directory
        domSnapshotPath = path.join(SNAPSHOTS_SUBDIR, slug, filename)
      } catch (err) {
        process.stderr.write(
          `[cypress-mcp] Failed to write DOM snapshot for "${titlePath}": ${getErrorMessage(err)}\n`,
        )
      }
    }

    return {
      title: titlePath,
      state: test.state,
      duration: test.duration ?? 0,
      error: test.displayError ? redactSecrets(test.displayError) : null,
      domSnapshotPath,
      commands: logEntry?.commands ?? [],
      consoleErrors: logEntry?.consoleErrors ?? [],
      networkErrors: logEntry?.networkErrors ?? [],
    }
  })

  const screenshots = (options.screenshots ?? true)
    ? (results.screenshots ?? []).map((s: CypressCommandLine.ScreenshotInformation) => s.path)
    : []

  return {
    spec: spec.relative,
    stats: {
      passes: results.stats?.passes ?? 0,
      failures: results.stats?.failures ?? 0,
      pending: results.stats?.pending ?? 0,
      skipped: results.stats?.skipped ?? 0,
      duration: results.stats?.duration ?? 0,
    },
    screenshots,
    tests,
  }
}

export function cypressMcpPlugin(
  on: Cypress.PluginEvents,
  config: Cypress.PluginConfigOptions,
  options: McpPluginOptions = {},
): void {
  const projectRoot = config.projectRoot ?? process.cwd()
  const outputDir = path.join(projectRoot, OUTPUT_DIR_NAME)
  const outputFile = path.join(outputDir, 'last-run.json')
  const snapshotsDir = path.join(outputDir, SNAPSHOTS_SUBDIR)

  // Accumulates results keyed by spec path — rerun of the same spec updates in place
  const runSpecs = new Map<string, SpecResult>()
  let runTimestamp = new Date().toISOString()

  // Per-test command logs (keyed by test title path), reset after each spec
  const testLogs = new Map<string, TestLogPayload>()

  function writeRunData(): void {
    const data: RunData = { timestamp: runTimestamp, specs: Array.from(runSpecs.values()) }
    mkdirSync(outputDir, { recursive: true })
    // M8: atomic write — write to temp file then rename to prevent torn reads from concurrent
    // processes or readers seeing partial JSON during the write window
    const tmpFile = `${outputFile}.tmp`
    safeWriteFileSync(tmpFile, JSON.stringify(data, null, 2))
    renameSync(tmpFile, outputFile) // POSIX rename(2) is atomic
  }

  // cypress run: fires before all specs — reset accumulator
  on('before:run', () => {
    runSpecs.clear()
    testLogs.clear()
    runTimestamp = new Date().toISOString()
    // Fix #9: Clean up stale snapshots from previous runs — prevents unbounded growth
    // Security: check for symlink before recursive delete to prevent symlink-following attack
    try {
      if (lstatSync(snapshotsDir).isSymbolicLink()) {
        process.stderr.write(`[cypress-mcp] Refusing to delete symlink at snapshots dir: ${snapshotsDir}\n`)
        return
      }
    } catch {
      // ENOENT = directory doesn't exist yet, nothing to clean
    }
    rmSync(snapshotsDir, { recursive: true, force: true })
  })

  // Clear testLogs before each spec to prevent stale data bleeding across specs
  // if after:spec was skipped due to crash/abort
  on('before:spec', () => {
    testLogs.clear()
  })

  on('task', {
    // H1: validate payload at runtime — TypeScript types don't survive Cypress IPC serialization.
    // An attacker who can call cy.task() directly can send arbitrary payloads.
    mcpSaveTestLog(rawPayload: unknown): null {
      const result = TestLogPayloadSchema.safeParse(rawPayload)
      if (!result.success) {
        process.stderr.write(
          `[cypress-mcp] Rejected invalid mcpSaveTestLog payload: ${result.error.message}\n`,
        )
        return null
      }
      if (testLogs.size >= MAX_TEST_LOG_ENTRIES && !testLogs.has(result.data.testTitle)) {
        process.stderr.write('[cypress-mcp] testLogs cap reached, ignoring new entry\n')
        return null
      }
      testLogs.set(result.data.testTitle, result.data)
      return null
    },
  })

  on('after:spec', (spec: Cypress.Spec, results: CypressCommandLine.RunResult) => {
    try {
      runSpecs.set(spec.relative, buildSpecResult(spec, results, testLogs, options, snapshotsDir))
      writeRunData()
    } catch (err) {
      process.stderr.write(
        `[cypress-mcp] Failed to write last-run.json: ${getErrorMessage(err)}\n`,
      )
    } finally {
      testLogs.clear()
    }
  })

}
