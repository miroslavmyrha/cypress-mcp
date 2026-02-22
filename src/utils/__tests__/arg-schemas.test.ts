import { describe, it, expect } from 'vitest'
import { ListSpecsArgs, ReadSpecArgs, RunSpecArgs, GetScreenshotArgs, QueryDomArgs } from '../arg-schemas.js'

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

  it('rejects brace expansion patterns (prevents absolute path injection via glob expansion)', () => {
    expect(() => ListSpecsArgs.parse({ pattern: '{**/*.cy.ts,/etc/passwd}' })).toThrow('brace expansion')
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

describe('GetScreenshotArgs — path validation with traversal prevention', () => {
  it('rejects empty path', () => {
    expect(() => GetScreenshotArgs.parse({ path: '' })).toThrow()
  })

  it('rejects paths containing .. (directory traversal)', () => {
    expect(() => GetScreenshotArgs.parse({ path: '../../etc/shadow' })).toThrow('must not contain ..')
  })

  it('accepts absolute paths (screenshots from get_last_run are absolute)', () => {
    const result = GetScreenshotArgs.parse({ path: '/project/cypress/screenshots/login.png' })
    expect(result.path).toBe('/project/cypress/screenshots/login.png')
  })

  it('accepts a valid relative screenshot path', () => {
    const result = GetScreenshotArgs.parse({ path: 'cypress/screenshots/login.png' })
    expect(result.path).toBe('cypress/screenshots/login.png')
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

  it('accepts headed and browser options', () => {
    const result = RunSpecArgs.parse({ spec: 'cypress/e2e/login.cy.ts', headed: true, browser: 'chrome' })
    expect(result.headed).toBe(true)
    expect(result.browser).toBe('chrome')
  })

  it('rejects invalid browser value', () => {
    expect(() => RunSpecArgs.parse({ spec: 'a.cy.ts', browser: 'safari' })).toThrow()
  })

  it('accepts spec without headed/browser (both optional)', () => {
    const result = RunSpecArgs.parse({ spec: 'cypress/e2e/login.cy.ts' })
    expect(result.headed).toBeUndefined()
    expect(result.browser).toBeUndefined()
  })
})

describe('QueryDomArgs — input validation', () => {
  it('rejects empty spec', () => {
    expect(() => QueryDomArgs.parse({ spec: '', testTitle: 'title', selector: 'div' })).toThrow()
  })

  it('rejects empty testTitle', () => {
    expect(() => QueryDomArgs.parse({ spec: 'a.cy.ts', testTitle: '', selector: 'div' })).toThrow()
  })

  it('rejects empty selector', () => {
    expect(() => QueryDomArgs.parse({ spec: 'a.cy.ts', testTitle: 'title', selector: '' })).toThrow()
  })

  it('rejects spec exceeding 2048 chars', () => {
    expect(() => QueryDomArgs.parse({ spec: 'x'.repeat(2049), testTitle: 'title', selector: 'div' })).toThrow('too long')
  })

  it('rejects testTitle exceeding 500 chars', () => {
    expect(() => QueryDomArgs.parse({ spec: 'a.cy.ts', testTitle: 'x'.repeat(501), selector: 'div' })).toThrow('too long')
  })

  it('accepts valid input', () => {
    const result = QueryDomArgs.parse({ spec: 'cypress/e2e/login.cy.ts', testTitle: 'login > should login', selector: 'button' })
    expect(result.spec).toBe('cypress/e2e/login.cy.ts')
    expect(result.testTitle).toBe('login > should login')
    expect(result.selector).toBe('button')
  })
})
