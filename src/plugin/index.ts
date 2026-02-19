/// <reference types="cypress" />
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { specSlug, testFilename } from '../utils/slug.js'

// CypressCommandLine and Cypress are global namespaces from the cypress types reference above

interface CommandEntry {
  name: string
  message: string
}

interface NetworkError {
  method: string
  url: string
  status: number
}

// H1: Zod schema for runtime validation of mcpSaveTestLog task payload.
// TypeScript interfaces provide zero runtime protection — any cy.task() caller can bypass them.
const CommandEntrySchema = z.object({
  name: z.string().max(100),
  message: z.string().max(1_000),
})

const NetworkErrorSchema = z.object({
  method: z.string().max(10),
  url: z.string().max(2_048),
  status: z.number().int().min(100).max(599),
})

const TestLogPayloadSchema = z.object({
  testTitle: z.string().max(500),
  commands: z.array(CommandEntrySchema).max(200),
  // H1: server-side size cap — support/index.ts caps at 100KB but task callers can bypass it
  domSnapshot: z.string().max(200_000).nullable(),
  consoleErrors: z.array(z.string().max(1_000)).max(50),
  networkErrors: z.array(NetworkErrorSchema).max(50),
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

// H22: Pattern-based redaction for displayError — assertion failures may contain
// secrets (JWTs, passwords, tokens) from test assertions comparing expected vs actual values.
// Fix #4: Relaxed — optional signature segment catches unsigned JWTs and short segments
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g
// Fix #2: JSON-formatted secrets like "password":"secret123" bypass the key=value SECRET_RE
const SECRET_JSON_RE = /"(password|secret|token|key|auth|bearer|passwd|credential)"\s*:\s*"[^"]{4,}"/gi
const SECRET_RE = /(password|secret|token|key|auth|bearer)\s*[=:]\s*["']?[^\s"',}\]]{4,}/gi

export function redactSecrets(text: string): string {
  return text
    .replace(JWT_RE, '[jwt-redacted]')
    .replace(SECRET_JSON_RE, '"$1":"[redacted]"')
    .replace(SECRET_RE, '$1=[redacted]')
}

const OUTPUT_DIR_NAME = '.cypress-mcp'
const SNAPSHOTS_SUBDIR = 'snapshots'

// Fix #10: Refuse to write through symlinks — readers already check via realpath(),
// but writers must also guard against symlink targets replacing snapshot or temp files.
function safeWriteFileSync(filePath: string, content: string): void {
  try {
    const stat = lstatSync(filePath)
    if (stat.isSymbolicLink()) {
      process.stderr.write(`[cypress-mcp] Refusing to write to symlink: ${filePath}\n`)
      return
    }
  } catch {
    // ENOENT = file doesn't exist yet, safe to create
  }
  writeFileSync(filePath, content, 'utf-8')
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
        const specDir = path.join(snapshotsDir, specSlug(spec.relative))
        mkdirSync(specDir, { recursive: true })
        const filename = testFilename(titlePath)
        const snapshotFile = path.join(specDir, filename)
        safeWriteFileSync(snapshotFile, logEntry.domSnapshot)
        // Store as relative path from .cypress-mcp/ directory
        domSnapshotPath = path.join(SNAPSHOTS_SUBDIR, specSlug(spec.relative), filename)
      } catch (err) {
        process.stderr.write(
          `[cypress-mcp] Failed to write DOM snapshot for "${titlePath}": ${err instanceof Error ? err.message : String(err)}\n`,
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
    runTimestamp = new Date().toISOString()
    // Fix #9: Clean up stale snapshots from previous runs — prevents unbounded growth
    rmSync(snapshotsDir, { recursive: true, force: true })
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
        `[cypress-mcp] Failed to write last-run.json: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    } finally {
      testLogs.clear()
    }
  })

  // cypress run: fires after all specs — no-op, file already written incrementally
  // (kept for potential future use, e.g. writing aggregate stats)
  on('after:run', () => {
    // file is already up to date from after:spec writes
  })
}
