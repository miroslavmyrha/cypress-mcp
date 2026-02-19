import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs/promises')

import { readFile, stat, realpath } from 'node:fs/promises'
import { getLastRun } from '../get-last-run.js'

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)
const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'
const REAL_FILE = `${PROJECT_ROOT}/.cypress-mcp/last-run.json`

const VALID_RUN_DATA = {
  timestamp: '2024-01-01T00:00:00.000Z',
  specs: [
    {
      spec: 'cypress/e2e/login.cy.ts',
      stats: { passes: 1, failures: 0, pending: 0, skipped: 0, duration: 100 },
      screenshots: [],
      tests: [
        {
          title: 'should login',
          state: 'passed',
          duration: 100,
          error: null,
          domSnapshotPath: null,
          commands: [
            { name: 'type', message: 'secret-password' },
            { name: 'click', message: 'Login button' },
          ],
          consoleErrors: [],
          networkErrors: [],
        },
      ],
    },
  ],
}

function setupValidFile(data: unknown = VALID_RUN_DATA) {
  mockRealpath.mockResolvedValue(REAL_FILE as never)
  mockStat.mockResolvedValue({ size: 1000 } as never)
  mockReadFile.mockResolvedValue(JSON.stringify(data) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getLastRun', () => {
  it('returns NO_RESULTS_MESSAGE when file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockRealpath.mockRejectedValue(err as never)

    const result = await getLastRun(PROJECT_ROOT)
    expect(result).toMatch(/No test results yet/)
  })

  it('returns error message when realpath resolves to path outside project root (symlink attack)', async () => {
    mockRealpath.mockResolvedValue('/etc/secrets' as never)

    const result = await getLastRun(PROJECT_ROOT)
    expect(result).toMatch(/symlink outside the project root/)
  })

  it('returns error message when file exceeds 50 MB', async () => {
    mockRealpath.mockResolvedValue(REAL_FILE as never)
    mockStat.mockResolvedValue({ size: 51 * 1024 * 1024 } as never)

    const result = await getLastRun(PROJECT_ROOT)
    expect(result).toMatch(/too large/)
  })

  it('returns error message when file contains invalid JSON', async () => {
    mockRealpath.mockResolvedValue(REAL_FILE as never)
    mockStat.mockResolvedValue({ size: 100 } as never)
    mockReadFile.mockResolvedValue('{ not valid json' as never)

    const result = await getLastRun(PROJECT_ROOT)
    expect(result).toMatch(/invalid JSON/)
  })

  it('returns error message when JSON has unexpected structure', async () => {
    mockRealpath.mockResolvedValue(REAL_FILE as never)
    mockStat.mockResolvedValue({ size: 100 } as never)
    // specs must be an array per schema
    mockReadFile.mockResolvedValue(JSON.stringify({ specs: 'not-an-array' }) as never)

    const result = await getLastRun(PROJECT_ROOT)
    expect(result).toMatch(/unexpected structure/)
  })

  it('redacts "type" command message in passing tests (MCP10)', async () => {
    setupValidFile()

    const result = await getLastRun(PROJECT_ROOT)
    const data = JSON.parse(result)
    const commands = data.specs[0].tests[0].commands
    const typeCmd = commands.find((c: { name: string }) => c.name === 'type')
    expect(typeCmd.message).toBe('[redacted]')
  })

  it('redacts "clear" command message in passing tests (MCP10)', async () => {
    const data = {
      ...VALID_RUN_DATA,
      specs: [
        {
          ...VALID_RUN_DATA.specs[0],
          tests: [
            {
              ...VALID_RUN_DATA.specs[0].tests[0],
              commands: [{ name: 'clear', message: 'input value' }],
            },
          ],
        },
      ],
    }
    setupValidFile(data)

    const result = await getLastRun(PROJECT_ROOT)
    const parsed = JSON.parse(result)
    const clearCmd = parsed.specs[0].tests[0].commands[0]
    expect(clearCmd.message).toBe('[redacted]')
  })

  it('does not redact non-sensitive commands in passing tests', async () => {
    setupValidFile()

    const result = await getLastRun(PROJECT_ROOT)
    const data = JSON.parse(result)
    const clickCmd = data.specs[0].tests[0].commands.find(
      (c: { name: string }) => c.name === 'click',
    )
    expect(clickCmd.message).toBe('Login button')
  })

  it('does NOT redact commands in failed tests', async () => {
    const data = {
      ...VALID_RUN_DATA,
      specs: [
        {
          ...VALID_RUN_DATA.specs[0],
          tests: [
            {
              ...VALID_RUN_DATA.specs[0].tests[0],
              state: 'failed',
              commands: [{ name: 'type', message: 'secret-password' }],
            },
          ],
        },
      ],
    }
    setupValidFile(data)

    const result = await getLastRun(PROJECT_ROOT)
    const parsed = JSON.parse(result)
    const typeCmd = parsed.specs[0].tests[0].commands[0]
    expect(typeCmd.message).toBe('secret-password')
  })

  it('failedOnly: returns only specs containing failed tests', async () => {
    const data = {
      timestamp: '2024-01-01T00:00:00.000Z',
      specs: [
        {
          spec: 'passing.cy.ts',
          tests: [{ title: 'pass', state: 'passed', commands: [] }],
        },
        {
          spec: 'failing.cy.ts',
          tests: [{ title: 'fail', state: 'failed', commands: [] }],
        },
      ],
    }
    setupValidFile(data)

    const result = await getLastRun(PROJECT_ROOT, true)
    const parsed = JSON.parse(result)
    expect(parsed.specs).toHaveLength(1)
    expect(parsed.specs[0].spec).toBe('failing.cy.ts')
  })

  it('failedOnly: filters out passing tests within specs that have mixed results', async () => {
    const data = {
      timestamp: '2024-01-01T00:00:00.000Z',
      specs: [
        {
          spec: 'mixed.cy.ts',
          tests: [
            { title: 'pass', state: 'passed', commands: [] },
            { title: 'fail', state: 'failed', commands: [] },
          ],
        },
      ],
    }
    setupValidFile(data)

    const result = await getLastRun(PROJECT_ROOT, true)
    const parsed = JSON.parse(result)
    expect(parsed.specs[0].tests).toHaveLength(1)
    expect(parsed.specs[0].tests[0].title).toBe('fail')
  })

  it('rethrows non-ENOENT errors from realpath', async () => {
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    mockRealpath.mockRejectedValue(err as never)

    await expect(getLastRun(PROJECT_ROOT)).rejects.toThrow('EPERM')
  })
})
