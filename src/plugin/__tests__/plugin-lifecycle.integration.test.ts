import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cypressMcpPlugin } from '../index.js'
import { OUTPUT_DIR_NAME, SNAPSHOTS_SUBDIR } from '../../utils/constants.js'

/**
 * Plugin lifecycle integration tests — real disk I/O, no mocks.
 *
 * Simulates Cypress lifecycle by calling registered event handlers directly:
 *   before:run → before:spec → mcpSaveTestLog × N → after:spec → verify files on disk
 */

// ─── Types for registered handlers ─────────────────────────────────────────

type BeforeRunHandler = () => void
type BeforeSpecHandler = () => void
type AfterSpecHandler = (spec: Cypress.Spec, results: CypressCommandLine.RunResult) => void
type TaskHandlers = Record<string, (payload: unknown) => null>

interface PluginHandlers {
  'before:run': BeforeRunHandler
  'before:spec': BeforeSpecHandler
  'after:spec': AfterSpecHandler
  task: TaskHandlers
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupPlugin(projectRoot: string, options: { screenshots?: boolean } = {}): PluginHandlers {
  const handlers: Partial<PluginHandlers> = {}
  const on = (event: string, handler: unknown) => {
    if (event === 'task') {
      handlers.task = handler as TaskHandlers
    } else {
      (handlers as Record<string, unknown>)[event] = handler
    }
  }
  cypressMcpPlugin(on as never, { projectRoot } as never, options)
  return handlers as PluginHandlers
}

function makeSpec(relative: string): Cypress.Spec {
  return {
    name: path.basename(relative),
    relative,
    absolute: `/fake/${relative}`,
  } as Cypress.Spec
}

function makeResults(overrides: {
  tests?: Array<{
    title: string[]
    state: string
    duration?: number
    displayError?: string | null
  }>
  screenshots?: Array<{ path: string }>
  stats?: Partial<CypressCommandLine.RunResult['stats']>
}): CypressCommandLine.RunResult {
  const tests = (overrides.tests ?? []).map((t) => ({
    title: t.title,
    state: t.state,
    duration: t.duration ?? 100,
    displayError: t.displayError ?? null,
    attempts: [],
  }))
  return {
    tests,
    screenshots: overrides.screenshots ?? [],
    stats: {
      suites: 1,
      tests: tests.length,
      passes: tests.filter((t) => t.state === 'passed').length,
      failures: tests.filter((t) => t.state === 'failed').length,
      pending: tests.filter((t) => t.state === 'pending').length,
      skipped: 0,
      duration: tests.reduce((sum, t) => sum + t.duration, 0),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      ...overrides.stats,
    },
    error: null,
    video: null,
    spec: {} as Cypress.Spec,
    shouldUploadVideo: false,
  } as unknown as CypressCommandLine.RunResult
}

function readLastRun(projectRoot: string): {
  timestamp: string
  specs: Array<{
    spec: string
    stats: Record<string, number>
    screenshots: string[]
    tests: Array<{
      title: string
      state: string
      error: string | null
      domSnapshotPath: string | null
      commands: Array<{ name: string; message: string }>
      consoleErrors: string[]
      networkErrors: Array<{ method: string; url: string; status: number }>
    }>
  }>
} {
  const filePath = path.join(projectRoot, OUTPUT_DIR_NAME, 'last-run.json')
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

function makeTestLog(testTitle: string, overrides: {
  commands?: Array<{ name: string; message: string }>
  domSnapshot?: string | null
  consoleErrors?: string[]
  networkErrors?: Array<{ method: string; url: string; status: number }>
} = {}) {
  return {
    testTitle,
    commands: overrides.commands ?? [{ name: 'click', message: '.btn' }],
    domSnapshot: overrides.domSnapshot ?? null,
    consoleErrors: overrides.consoleErrors ?? [],
    networkErrors: overrides.networkErrors ?? [],
  }
}

// ─── Suppress stderr from plugin ────────────────────────────────────────────

let stderrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  stderrSpy.mockRestore()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('plugin lifecycle integration', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'cypress-mcp-lifecycle-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('full lifecycle: before:run → before:spec → mcpSaveTestLog → after:spec → last-run.json', () => {
    const h = setupPlugin(tempDir)

    h['before:run']()
    h['before:spec']()

    h.task.mcpSaveTestLog(makeTestLog('Suite > test A', {
      commands: [{ name: 'visit', message: '/' }, { name: 'click', message: '.btn' }],
      consoleErrors: ['Uncaught Error: boom'],
      networkErrors: [{ method: 'GET', url: 'http://api/data', status: 500 }],
    }))

    h.task.mcpSaveTestLog(makeTestLog('Suite > test B'))

    const spec = makeSpec('cypress/e2e/suite.cy.ts')
    const results = makeResults({
      tests: [
        { title: ['Suite', 'test A'], state: 'failed', displayError: 'AssertionError: expected true to be false' },
        { title: ['Suite', 'test B'], state: 'passed' },
      ],
    })

    h['after:spec'](spec, results)

    const data = readLastRun(tempDir)
    expect(data.specs).toHaveLength(1)
    expect(data.specs[0].spec).toBe('cypress/e2e/suite.cy.ts')
    expect(data.specs[0].tests).toHaveLength(2)

    const testA = data.specs[0].tests[0]
    expect(testA.title).toBe('Suite > test A')
    expect(testA.state).toBe('failed')
    expect(testA.error).toBe('AssertionError: expected true to be false')
    expect(testA.commands).toHaveLength(2)
    expect(testA.consoleErrors).toEqual(['Uncaught Error: boom'])
    expect(testA.networkErrors).toEqual([{ method: 'GET', url: 'http://api/data', status: 500 }])

    const testB = data.specs[0].tests[1]
    expect(testB.title).toBe('Suite > test B')
    expect(testB.state).toBe('passed')
    expect(testB.error).toBeNull()
  })

  it('DOM snapshot: writes snapshot file to disk', () => {
    const h = setupPlugin(tempDir)

    h['before:run']()
    h['before:spec']()

    const snapshotHtml = '<html><body><h1>Snapshot</h1></body></html>'
    h.task.mcpSaveTestLog(makeTestLog('Login > should show error', {
      domSnapshot: snapshotHtml,
    }))

    const spec = makeSpec('cypress/e2e/login.cy.ts')
    const results = makeResults({
      tests: [{ title: ['Login', 'should show error'], state: 'failed' }],
    })

    h['after:spec'](spec, results)

    const data = readLastRun(tempDir)
    const test = data.specs[0].tests[0]
    expect(test.domSnapshotPath).toBeTruthy()
    expect(test.domSnapshotPath).toContain(SNAPSHOTS_SUBDIR)

    // Verify snapshot file exists on disk
    const snapshotPath = path.join(tempDir, OUTPUT_DIR_NAME, test.domSnapshotPath!)
    expect(existsSync(snapshotPath)).toBe(true)
    const content = readFileSync(snapshotPath, 'utf-8')
    expect(content).toBe(snapshotHtml)
  })

  it('multi-spec: last-run.json contains both specs', () => {
    const h = setupPlugin(tempDir)

    h['before:run']()

    // Spec A
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('A > test 1'))
    h['after:spec'](
      makeSpec('cypress/e2e/a.cy.ts'),
      makeResults({ tests: [{ title: ['A', 'test 1'], state: 'passed' }] }),
    )

    // Spec B
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('B > test 1'))
    h['after:spec'](
      makeSpec('cypress/e2e/b.cy.ts'),
      makeResults({ tests: [{ title: ['B', 'test 1'], state: 'passed' }] }),
    )

    const data = readLastRun(tempDir)
    expect(data.specs).toHaveLength(2)
    expect(data.specs[0].spec).toBe('cypress/e2e/a.cy.ts')
    expect(data.specs[1].spec).toBe('cypress/e2e/b.cy.ts')
  })

  it('before:run reset: second run clears results from first run', () => {
    const h = setupPlugin(tempDir)

    // First run
    h['before:run']()
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('Old > test'))
    h['after:spec'](
      makeSpec('cypress/e2e/old.cy.ts'),
      makeResults({ tests: [{ title: ['Old', 'test'], state: 'passed' }] }),
    )

    const dataAfterFirst = readLastRun(tempDir)
    expect(dataAfterFirst.specs).toHaveLength(1)

    // Second run — should reset
    h['before:run']()
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('New > test'))
    h['after:spec'](
      makeSpec('cypress/e2e/new.cy.ts'),
      makeResults({ tests: [{ title: ['New', 'test'], state: 'passed' }] }),
    )

    const dataAfterSecond = readLastRun(tempDir)
    expect(dataAfterSecond.specs).toHaveLength(1)
    expect(dataAfterSecond.specs[0].spec).toBe('cypress/e2e/new.cy.ts')
  })

  it('testLogs cleared between specs: logs from spec A do not appear in spec B', () => {
    const h = setupPlugin(tempDir)

    h['before:run']()

    // Spec A — logs "A > test 1"
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('A > test 1', {
      commands: [{ name: 'visit', message: '/a' }],
    }))
    h['after:spec'](
      makeSpec('cypress/e2e/a.cy.ts'),
      makeResults({ tests: [{ title: ['A', 'test 1'], state: 'passed' }] }),
    )

    // Spec B — does NOT log for "A > test 1", only for "B > test 1"
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('B > test 1', {
      commands: [{ name: 'visit', message: '/b' }],
    }))
    h['after:spec'](
      makeSpec('cypress/e2e/b.cy.ts'),
      makeResults({
        tests: [
          { title: ['A', 'test 1'], state: 'passed' }, // same title as spec A's test
          { title: ['B', 'test 1'], state: 'passed' },
        ],
      }),
    )

    const data = readLastRun(tempDir)
    // Spec B's "A > test 1" should have NO commands (testLogs were cleared)
    const specB = data.specs[1]
    const staleTest = specB.tests.find((t) => t.title === 'A > test 1')!
    expect(staleTest.commands).toEqual([])

    // Spec B's "B > test 1" should have its commands
    const freshTest = specB.tests.find((t) => t.title === 'B > test 1')!
    expect(freshTest.commands).toEqual([{ name: 'visit', message: '/b' }])
  })

  it('error redaction: JWT in displayError is redacted in last-run.json', () => {
    const h = setupPlugin(tempDir)

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    h['before:run']()
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('Auth > should reject'))
    h['after:spec'](
      makeSpec('cypress/e2e/auth.cy.ts'),
      makeResults({
        tests: [{ title: ['Auth', 'should reject'], state: 'failed', displayError: `Token was: ${jwt}` }],
      }),
    )

    const data = readLastRun(tempDir)
    const test = data.specs[0].tests[0]
    expect(test.error).not.toContain('eyJ')
    expect(test.error).toContain('[jwt-redacted]')
  })

  it('screenshots=false: screenshots array is empty in output', () => {
    const h = setupPlugin(tempDir, { screenshots: false })

    h['before:run']()
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('Viz > test'))
    h['after:spec'](
      makeSpec('cypress/e2e/viz.cy.ts'),
      makeResults({
        tests: [{ title: ['Viz', 'test'], state: 'failed' }],
        screenshots: [{ path: '/tmp/screenshot.png' }],
      }),
    )

    const data = readLastRun(tempDir)
    expect(data.specs[0].screenshots).toEqual([])
  })

  it('atomic write: last-run.json exists (no .tmp file left behind)', () => {
    const h = setupPlugin(tempDir)

    h['before:run']()
    h['before:spec']()
    h.task.mcpSaveTestLog(makeTestLog('Atomic > test'))
    h['after:spec'](
      makeSpec('cypress/e2e/atomic.cy.ts'),
      makeResults({ tests: [{ title: ['Atomic', 'test'], state: 'passed' }] }),
    )

    const outputDir = path.join(tempDir, OUTPUT_DIR_NAME)
    const files = readdirSync(outputDir)
    expect(files).toContain('last-run.json')
    expect(files).not.toContain('last-run.json.tmp')
  })
})
