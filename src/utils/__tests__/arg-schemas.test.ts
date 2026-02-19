import { describe, it, expect } from 'vitest'
import { ListSpecsArgs, ReadSpecArgs, RunSpecArgs } from '../arg-schemas.js'

// M5: arg schemas are the server-side input validation layer — the only thing
// preventing Claude from passing .. or absolute paths into glob/tool functions.

describe('ListSpecsArgs — M5 glob pattern traversal prevention', () => {
  it('rejects patterns containing .. (directory traversal via glob)', () => {
    expect(() => ListSpecsArgs.parse({ pattern: '../secrets/**' })).toThrow('must not contain ..')
  })

  it('rejects absolute path patterns', () => {
    expect(() => ListSpecsArgs.parse({ pattern: '/etc/passwd' })).toThrow('relative path')
  })

  it('accepts a valid relative glob pattern', () => {
    const result = ListSpecsArgs.parse({ pattern: 'cypress/e2e/**/*.cy.ts' })
    expect(result.pattern).toBe('cypress/e2e/**/*.cy.ts')
  })

  it('accepts missing pattern (uses tool default)', () => {
    const result = ListSpecsArgs.parse({})
    expect(result.pattern).toBeUndefined()
  })
})

describe('ReadSpecArgs — path validation with traversal prevention', () => {
  it('rejects empty path', () => {
    expect(() => ReadSpecArgs.parse({ path: '' })).toThrow()
  })

  it('rejects paths containing .. (directory traversal)', () => {
    expect(() => ReadSpecArgs.parse({ path: '../secrets/key.ts' })).toThrow('must not contain ..')
  })

  it('rejects absolute paths', () => {
    expect(() => ReadSpecArgs.parse({ path: '/etc/passwd' })).toThrow('relative path')
  })

  it('accepts a valid relative path', () => {
    const result = ReadSpecArgs.parse({ path: 'cypress/e2e/login.cy.ts' })
    expect(result.path).toBe('cypress/e2e/login.cy.ts')
  })
})

describe('RunSpecArgs — spec validation with traversal prevention', () => {
  it('rejects empty spec', () => {
    expect(() => RunSpecArgs.parse({ spec: '' })).toThrow()
  })

  it('rejects specs containing .. (directory traversal)', () => {
    expect(() => RunSpecArgs.parse({ spec: '../../etc/passwd' })).toThrow('must not contain ..')
  })

  it('rejects absolute spec paths', () => {
    expect(() => RunSpecArgs.parse({ spec: '/tmp/malicious.cy.ts' })).toThrow('relative path')
  })

  it('accepts a valid relative spec', () => {
    const result = RunSpecArgs.parse({ spec: 'cypress/e2e/login.cy.ts' })
    expect(result.spec).toBe('cypress/e2e/login.cy.ts')
  })
})
