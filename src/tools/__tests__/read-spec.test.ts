import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { readFile } from 'node:fs/promises'
import { readSpec } from '../read-spec.js'

const mockReadFile = vi.mocked(readFile)

const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readSpec', () => {
  it('throws on path traversal outside project root', async () => {
    await expect(readSpec(PROJECT_ROOT, '../../../etc/passwd')).rejects.toThrow(
      'Path traversal detected',
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
})
