import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cypressMcpPlugin, redactSecrets } from '../index.js'

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

describe('redactSecrets — H22 displayError secret redaction', () => {
  it('redacts JWT tokens from assertion failure messages', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.abc123def456'
    const input = `expected "Bearer ${jwt}" to equal "Bearer xxx"`
    const result = redactSecrets(input)
    expect(result).toContain('[jwt-redacted]')
    expect(result).not.toContain(jwt)
  })

  it('redacts password values from assertion failures', () => {
    const input = 'expected { password: "s3cretP@ss!" } to deeply equal {}'
    const result = redactSecrets(input)
    expect(result).toContain('password=[redacted]')
    expect(result).not.toContain('s3cretP@ss!')
  })

  it('redacts token and secret key-value patterns', () => {
    const input = 'AssertionError: token=sk_live_abc123xyz auth: "Bearer mytoken123"'
    const result = redactSecrets(input)
    expect(result).toContain('token=[redacted]')
    expect(result).toContain('auth=[redacted]')
  })

  it('redacts JSON-formatted secrets like "password":"value" (Fix #2)', () => {
    const input = '{"password":"secret123","user":"admin"}'
    const result = redactSecrets(input)
    expect(result).toContain('"password":"[redacted]"')
    expect(result).not.toContain('secret123')
    // Non-secret key should be untouched
    expect(result).toContain('"user":"admin"')
  })

  it('redacts JSON secrets with various key names (Fix #2)', () => {
    const cases = [
      { input: '{"token":"abc12345"}', key: 'token' },
      { input: '{"credential":"mypass99"}', key: 'credential' },
      { input: '{"passwd":"longpass1"}', key: 'passwd' },
      { input: '{"auth":"bearer_xyz"}', key: 'auth' },
    ]
    for (const { input, key } of cases) {
      const result = redactSecrets(input)
      expect(result).toContain(`"${key}":"[redacted]"`)
    }
  })

  it('redacts unsigned JWTs (empty signature segment) (Fix #4)', () => {
    // JWT with header.payload but empty signature: eyJ...eyJ...
    const unsignedJwt = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjF9.'
    const input = `token was ${unsignedJwt} in response`
    const result = redactSecrets(input)
    expect(result).toContain('[jwt-redacted]')
    expect(result).not.toContain('eyJ1c2VySWQiOjF9')
  })

  it('redacts JWTs without a signature segment at all (Fix #4)', () => {
    const noSigJwt = 'eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOjF9'
    const input = `found ${noSigJwt} leaked`
    const result = redactSecrets(input)
    expect(result).toContain('[jwt-redacted]')
    expect(result).not.toContain(noSigJwt)
  })

  it('passes through normal error text unchanged', () => {
    const input = 'AssertionError: expected 42 to equal 43'
    expect(redactSecrets(input)).toBe(input)
  })
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
