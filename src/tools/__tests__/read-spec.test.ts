import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { readSpec } from '../read-spec.js'

const mockReadFile = vi.mocked(readFile)
const mockRealpath = vi.mocked(realpath)
const mockStat = vi.mocked(stat)

const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
  // By default, realpath returns the resolved path unchanged (no symlinks)
  mockRealpath.mockImplementation(async (p) => p.toString())
  // By default, stat returns a small file (well under the 500 KB limit)
  mockStat.mockResolvedValue({ size: 100 } as never)
})

describe('readSpec', () => {
  it('throws on path traversal outside project root', async () => {
    await expect(readSpec(PROJECT_ROOT, '../../../etc/passwd')).rejects.toThrow(
      'Path must be within the project root',
    )
  })

  it('throws when symlink resolves outside project root', async () => {
    mockRealpath.mockResolvedValue('/etc/passwd' as never)

    await expect(readSpec(PROJECT_ROOT, 'cypress/e2e/evil-link.cy.ts')).rejects.toThrow(
      'Path escapes project root via symlink',
    )
  })

  it('throws when file extension is not an allowed spec extension', async () => {
    // Default realpath mock returns input unchanged — resolveSecurePath passes,
    // then readSpec's extension check rejects .env

    await expect(readSpec(PROJECT_ROOT, 'cypress/e2e/.env')).rejects.toThrow(
      'File extension not allowed',
    )
  })

  it('throws friendly error when spec file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err as never)

    await expect(readSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')).rejects.toThrow(
      'Spec file not found',
    )
  })

  it('throws friendly error on permission denied (EACCES)', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockReadFile.mockRejectedValue(err as never)

    await expect(readSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')).rejects.toThrow(
      'Permission denied',
    )
  })

  it('returns file content for a normal spec', async () => {
    const content = 'it("should work", () => {})'
    mockReadFile.mockResolvedValue(content as never)

    const result = await readSpec(PROJECT_ROOT, 'cypress/e2e/login.cy.ts')
    expect(result).toBe(content)
  })

  it('truncates content that exceeds 500 KB', async () => {
    const bigContent = 'x'.repeat(600_000)
    mockReadFile.mockResolvedValue(bigContent as never)

    const result = await readSpec(PROJECT_ROOT, 'cypress/e2e/big.cy.ts')
    expect(result).toMatch(/truncated at 500000 bytes/)
    expect(result.length).toBeLessThan(bigContent.length)
  })

  it('returns early when stat reports file larger than 500 KB (pre-read OOM prevention)', async () => {
    mockStat.mockResolvedValue({ size: 600_000 } as never)

    const result = await readSpec(PROJECT_ROOT, 'cypress/e2e/big.cy.ts')
    expect(result).toMatch(/File too large/)
    expect(result).toContain('600000')
    // readFile should NOT be called — the point is to avoid reading the file into memory
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('reads the symlink-resolved path (real), not the original path (resolved)', async () => {
    const realTarget = path.resolve(PROJECT_ROOT, 'cypress/e2e/actual-file.cy.ts')
    // Root resolves to itself; only file symlink resolves to a different path
    mockRealpath.mockImplementation(async (p) => {
      const str = p.toString()
      if (str === path.resolve(PROJECT_ROOT)) return str
      return realTarget
    })
    mockReadFile.mockResolvedValue('content' as never)

    await readSpec(PROJECT_ROOT, 'cypress/e2e/link.cy.ts')
    expect(mockReadFile).toHaveBeenCalledWith(realTarget, 'utf-8')
  })

  it.each([
    'login.cy.ts', 'login.cy.js', 'login.cy.tsx', 'login.cy.jsx',
    'login.spec.ts', 'login.spec.js', 'login.spec.tsx', 'login.spec.jsx',
  ])('allows reading %s extension', async (filename) => {
    const content = 'test content'
    mockReadFile.mockResolvedValue(content as never)

    const result = await readSpec(PROJECT_ROOT, `cypress/e2e/${filename}`)
    expect(result).toBe(content)
  })
})
