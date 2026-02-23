import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { realpath } from 'node:fs/promises'
import { resolveSecurePath, PathTraversalError } from '../path-security.js'

const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation(async (p) => p.toString())
})

describe('resolveSecurePath', () => {
  it('returns realpath-resolved path for a normal file within root', async () => {
    const result = await resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    expect(result).toBe('/fake/project/cypress/e2e/login.cy.ts')
  })

  it('throws PathTraversalError on path traversal outside root', async () => {
    await expect(
      resolveSecurePath(PROJECT_ROOT, '../../etc/passwd'),
    ).rejects.toThrow('Path must be within the project root')

    await expect(
      resolveSecurePath(PROJECT_ROOT, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('throws PathTraversalError when symlink resolves outside root', async () => {
    mockRealpath.mockResolvedValue('/etc/shadow' as never)

    await expect(
      resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/evil-link.cy.ts'),
    ).rejects.toThrow('Path escapes project root via symlink')

    mockRealpath.mockResolvedValue('/etc/shadow' as never)
    await expect(
      resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/evil-link.cy.ts'),
    ).rejects.toBeInstanceOf(PathTraversalError)
  })

  it('normalizes root with trailing slash', async () => {
    const result = await resolveSecurePath('/fake/project/', 'cypress/e2e/login.cy.ts')
    expect(result).toBe('/fake/project/cypress/e2e/login.cy.ts')
  })

  it('normalizes root with .. segments', async () => {
    await expect(
      resolveSecurePath('/fake/project/../project', '../../etc/passwd'),
    ).rejects.toThrow('Path must be within the project root')
  })

  it('lets ENOENT from realpath propagate (not wrapped as PathTraversalError)', async () => {
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockRealpath.mockRejectedValue(enoentErr as never)

    await expect(
      resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/missing.cy.ts'),
    ).rejects.toThrow('ENOENT')

    // Should NOT be a PathTraversalError — caller needs to distinguish ENOENT from traversal
    try {
      mockRealpath.mockRejectedValue(enoentErr as never)
      await resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/missing.cy.ts')
    } catch (err) {
      expect(err).not.toBeInstanceOf(PathTraversalError)
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
    }
  })

  it('lets non-ENOENT fs errors propagate', async () => {
    const eaccesErr = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockRealpath.mockRejectedValue(eaccesErr as never)

    await expect(
      resolveSecurePath(PROJECT_ROOT, 'cypress/e2e/protected.cy.ts'),
    ).rejects.toThrow('EACCES')
  })

  it('rejects root-equal path (file at exact root level is not under root)', async () => {
    // path.resolve('/fake/project', '') === '/fake/project'
    // which does NOT start with '/fake/project/' (note trailing sep)
    await expect(
      resolveSecurePath(PROJECT_ROOT, ''),
    ).rejects.toThrow('Path must be within the project root')
  })
})

describe('PathTraversalError', () => {
  it('is an instance of Error', () => {
    const err = new PathTraversalError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PathTraversalError)
  })

  it('has name set to PathTraversalError', () => {
    const err = new PathTraversalError('test message')
    expect(err.name).toBe('PathTraversalError')
    expect(err.message).toBe('test message')
  })
})
