import { describe, it, expect } from 'vitest'
import { specSlug, testFilename } from '../slug.js'

// Security property: output must be safe for use as a POSIX filesystem path component
describe('specSlug — POSIX-safe filesystem output', () => {
  it('never contains path separators (prevents directory traversal via slug)', () => {
    const adversarial = ['../escape', 'a/b/c', 'a\\b\\c', '../../root', '/absolute']
    for (const input of adversarial) {
      const result = specSlug(input)
      expect(result, `input: ${JSON.stringify(input)}`).not.toContain('/')
      expect(result, `input: ${JSON.stringify(input)}`).not.toContain('\\')
    }
  })

  it('never contains null bytes or control characters (prevents fs null-byte injection, L6)', () => {
    const withControls = 'foo\x00bar\x01\x1f\x7f\x80\x9fpath'
    const result = specSlug(withControls)
    expect(result).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
  })

  it('maps NFKC-equivalent paths to the same slug (prevents homoglyph bypass, L7)', () => {
    // Fullwidth ａ (U+FF41) normalizes to ASCII a under NFKC
    const fullwidth = specSlug('\uff41bc/test.cy.ts')
    const ascii = specSlug('abc/test.cy.ts')
    expect(fullwidth).toBe(ascii)
  })

  it('produces a bounded slug for arbitrarily long input (DoS prevention)', () => {
    const longPath = 'a/'.repeat(500) + 'spec.cy.ts'
    const result = specSlug(longPath)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(200)
    expect(result).not.toContain('/')
  })

  it('caps output length at 200 characters', () => {
    // Input that produces a slug longer than 200 chars before the cap
    const longInput = 'abcdefghij/'.repeat(50) + 'spec.cy.ts'
    const result = specSlug(longInput)
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('produces deterministic output (same input always gives same directory name)', () => {
    const input = 'cypress/e2e/auth/login.cy.ts'
    expect(specSlug(input)).toBe(specSlug(input))
  })

  it('typical path example — regression guard', () => {
    expect(specSlug('cypress/e2e/auth/login.cy.ts')).toBe('cypress-e2e-auth-login-cy-ts')
  })
})

// Security property: filename must be collision-resistant, bounded, and control-char-free
describe('testFilename — collision-resistant safe filename', () => {
  it('two titles that share a truncated prefix are distinguished by their SHA-256 hash', () => {
    // Both titles would produce the same 60-char slug after truncation,
    // but their hashes (computed before truncation) must differ
    const base = 'a'.repeat(61)
    const a = testFilename(base + ' variant-a')
    const b = testFilename(base + ' variant-b')
    expect(a).not.toBe(b)
  })

  it('NFKC-equivalent titles map to the same filename (canonical hash, prevents duplicate snapshots)', () => {
    const ascii = testFilename('a test case')
    const fullwidth = testFilename('\uff41 test case') // ａ = fullwidth a, NFKC → a
    expect(ascii).toBe(fullwidth)
  })

  it('never contains null bytes or control characters in output (L6)', () => {
    const result = testFilename('test\x00title\x01\x1f')
    expect(result).not.toMatch(/[\x00-\x1f]/)
  })

  it('output length is bounded regardless of title length (DoS prevention)', () => {
    const filename = testFilename('x'.repeat(1000))
    // slug cap 60 + separator + 8-char hash + .html = max ~72 chars
    expect(filename.length).toBeLessThan(80)
  })

  it('always produces a .html file extension', () => {
    expect(testFilename('any title')).toMatch(/\.html$/)
  })
})
