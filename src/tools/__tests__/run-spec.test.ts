import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('node:fs/promises')
vi.mock('node:child_process')

import { lstat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { runSpec } from '../run-spec.js'

const mockLstat = vi.mocked(lstat)
const mockSpawn = vi.mocked(spawn)

const PROJECT_ROOT = '/fake/project'

type MockProcess = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createMockProcess(opts: { exitCode?: number; neverClose?: boolean } = {}): MockProcess {
  const proc = new EventEmitter() as MockProcess
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  if (!opts.neverClose) {
    // Emit close in next event loop tick so callers can set up listeners first
    setImmediate(() => proc.emit('close', opts.exitCode ?? 0))
  }
  return proc
}

function setupNormalFile() {
  mockLstat.mockResolvedValue({ isSymbolicLink: () => false } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runSpec', () => {
  it('rejects absolute spec paths (Layer 1)', async () => {
    await expect(runSpec(PROJECT_ROOT, '/absolute/path/spec.cy.ts')).rejects.toThrow(
      'relative path',
    )
  })

  it('rejects path traversal outside project root (Layer 2)', async () => {
    await expect(runSpec(PROJECT_ROOT, '../../etc/passwd.cy.ts')).rejects.toThrow(
      'within the project root',
    )
  })

  it('rejects files with non-spec extensions (Layer 3)', async () => {
    await expect(runSpec(PROJECT_ROOT, 'cypress/e2e/login.ts')).rejects.toThrow(
      'spec must match',
    )
  })

  it('rejects symlink spec files (Layer 4)', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true } as never)

    await expect(runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')).rejects.toThrow(
      'symbolic link',
    )
  })

  it('throws friendly error when spec file does not exist (ENOENT, Layer 4)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockLstat.mockRejectedValue(err as never)

    await expect(runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')).rejects.toThrow(
      'Spec file not found',
    )
  })

  it('returns JSON result on successful run (exit 0)', async () => {
    setupNormalFile()
    const proc = createMockProcess({ exitCode: 0 })
    mockSpawn.mockReturnValue(proc as never)

    const result = await runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    const data = JSON.parse(result)
    expect(data.success).toBe(true)
    expect(data.exitCode).toBe(0)
  })

  it('returns JSON with success:false on non-zero exit', async () => {
    setupNormalFile()
    const proc = createMockProcess({ exitCode: 1 })
    mockSpawn.mockReturnValue(proc as never)

    const result = await runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    const data = JSON.parse(result)
    expect(data.success).toBe(false)
    expect(data.exitCode).toBe(1)
  })

  it('returns friendly error when Cypress binary is not found (ENOENT spawn error)', async () => {
    setupNormalFile()
    const proc = new EventEmitter() as MockProcess
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    mockSpawn.mockReturnValue(proc as never)

    const runPromise = runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    // Emit ENOENT error from spawn
    const spawnErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    setImmediate(() => proc.emit('error', spawnErr))

    await expect(runPromise).rejects.toThrow('Cypress binary not found')
  })

  it('spawns with shell:false to prevent command injection', async () => {
    setupNormalFile()
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc as never)

    await runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')

    const spawnOptions = mockSpawn.mock.calls[0][2] as { shell: boolean }
    expect(spawnOptions.shell).toBe(false)
  })

  it('spawns with minimal env — no GITHUB_TOKEN or DATABASE_URL (M4)', async () => {
    setupNormalFile()
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc as never)

    await runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')

    const spawnOptions = mockSpawn.mock.calls[0][2] as { env: Record<string, string> }
    expect(spawnOptions.env).toHaveProperty('PATH')
    expect(spawnOptions.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(spawnOptions.env).not.toHaveProperty('DATABASE_URL')
    expect(spawnOptions.env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })

  it('rejects concurrent spec runs (M3)', async () => {
    setupNormalFile()
    const hangingProc = createMockProcess({ neverClose: true })
    mockSpawn.mockReturnValue(hangingProc as never)

    // Start first run without awaiting — activeRuns++ happens synchronously
    const firstRun = runSpec(PROJECT_ROOT, 'cypress/e2e/spec1.cy.ts')

    // Second run should immediately reject
    await expect(runSpec(PROJECT_ROOT, 'cypress/e2e/spec2.cy.ts')).rejects.toThrow(
      'Another spec run is already in progress',
    )

    // Cleanup: close the hanging process so firstRun resolves
    hangingProc.emit('close', 0)
    await firstRun
  })

  it('caps output in result at 2 KB even when process emits large stdout (M10 memory guard)', async () => {
    setupNormalFile()
    const proc = createMockProcess({ neverClose: true })
    mockSpawn.mockReturnValue(proc as never)

    const runPromise = runSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    // Emit 200 KB of stdout — well above the 100 KB accumulation cap
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from('x'.repeat(200_000)))
      proc.emit('close', 0)
    })

    const result = await runPromise
    const data = JSON.parse(result)
    expect(data.output).not.toBeNull()
    expect(data.output!.length).toBeLessThanOrEqual(2_000)
  })

  it('accepts .spec.ts extension', async () => {
    setupNormalFile()
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc as never)

    const result = await runSpec(PROJECT_ROOT, 'src/login.spec.ts')
    const data = JSON.parse(result)
    expect(data.success).toBe(true)
  })
})
