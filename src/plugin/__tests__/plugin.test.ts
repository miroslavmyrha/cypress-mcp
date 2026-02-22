import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cypressMcpPlugin } from '../index.js'

// H1: mcpSaveTestLog accepts arbitrary payloads from cy.task() callers — TypeScript types
// provide zero runtime protection across Cypress IPC. Only Zod schema enforcement prevents
// memory DoS via oversized payloads or malformed data reaching server-side Maps.

const PROJECT_ROOT = '/tmp/fake-project'

function setupPlugin() {
  const taskHandlers: Record<string, (payload: unknown) => null> = {}
  const on = (event: string, handlers: unknown) => {
    if (event === 'task') {
      Object.assign(taskHandlers, handlers as Record<string, (p: unknown) => null>)
    }
  }
  cypressMcpPlugin(on as never, { projectRoot: PROJECT_ROOT } as never)
  return taskHandlers
}

const VALID_PAYLOAD = {
  testTitle: 'login > should login',
  commands: [{ name: 'click', message: '.submit' }],
  domSnapshot: null,
  consoleErrors: [],
  networkErrors: [],
}

let stderrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  stderrSpy.mockRestore()
})

describe('mcpSaveTestLog — H1 Zod payload validation', () => {
  it('accepts a valid payload without writing to stderr', () => {
    const { mcpSaveTestLog } = setupPlugin()
    mcpSaveTestLog(VALID_PAYLOAD)
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('rejects commands array exceeding 200 entries (prevents memory DoS via task flooding)', () => {
    const { mcpSaveTestLog } = setupPlugin()
    mcpSaveTestLog({
      ...VALID_PAYLOAD,
      commands: Array.from({ length: 201 }, () => ({ name: 'click', message: 'x' })),
    })
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected'))
  })

  it('rejects command message exceeding 1000 chars (prevents single oversized entry)', () => {
    const { mcpSaveTestLog } = setupPlugin()
    mcpSaveTestLog({
      ...VALID_PAYLOAD,
      commands: [{ name: 'type', message: 'x'.repeat(1001) }],
    })
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected'))
  })

  it('rejects testTitle exceeding 500 chars', () => {
    const { mcpSaveTestLog } = setupPlugin()
    mcpSaveTestLog({ ...VALID_PAYLOAD, testTitle: 'x'.repeat(501) })
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected'))
  })

  it('rejects domSnapshot exceeding 200 000 chars (server-side cap, prevents support/index.ts bypass)', () => {
    const { mcpSaveTestLog } = setupPlugin()
    mcpSaveTestLog({ ...VALID_PAYLOAD, domSnapshot: 'x'.repeat(200_001) })
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected'))
  })

  it('rejects completely malformed payload (null, string) without throwing', () => {
    const { mcpSaveTestLog } = setupPlugin()
    expect(() => mcpSaveTestLog(null)).not.toThrow()
    expect(() => mcpSaveTestLog('injection attempt')).not.toThrow()
    expect(stderrSpy).toHaveBeenCalledTimes(2)
  })
})
