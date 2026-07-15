import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs/promises')

import { realpath, readFile, stat } from 'node:fs/promises'
import { getConfig } from '../get-config.js'

const mockStat = vi.mocked(stat)
const mockReadFile = vi.mocked(readFile)
const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

/** Make realpath succeed only for the project root and the given filenames */
function existingFiles(...filenames: string[]) {
  const allowed = new Set([
    path.resolve(PROJECT_ROOT),
    ...filenames.map((f) => path.resolve(PROJECT_ROOT, f)),
  ])
  mockRealpath.mockImplementation(async (p) => {
    const str = p.toString()
    if (allowed.has(str)) return str
    throw enoent()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStat.mockResolvedValue({ size: 1_000 } as never)
  mockReadFile.mockResolvedValue('export default {}' as never)
})

describe('getConfig', () => {
  it('returns the TypeScript config when present', async () => {
    existingFiles('cypress.config.ts')

    const result = await getConfig(PROJECT_ROOT)
    expect(result.file).toBe('cypress.config.ts')
    expect(result.content).toBe('export default {}')
  })

  it('falls back through the filename order (ts → js → mjs → cjs)', async () => {
    existingFiles('cypress.config.cjs')

    const result = await getConfig(PROJECT_ROOT)
    expect(result.file).toBe('cypress.config.cjs')
  })

  it('prefers ts over js when both exist', async () => {
    existingFiles('cypress.config.ts', 'cypress.config.js')

    const result = await getConfig(PROJECT_ROOT)
    expect(result.file).toBe('cypress.config.ts')
  })

  it('throws when no config file exists', async () => {
    existingFiles()

    await expect(getConfig(PROJECT_ROOT)).rejects.toThrow('No Cypress config found')
  })

  it('redacts secret-looking values in the config content', async () => {
    existingFiles('cypress.config.ts')
    mockReadFile.mockResolvedValue(
      'export default { env: { password: "hunter22secret" } }' as never,
    )

    const result = await getConfig(PROJECT_ROOT)
    expect(result.content).not.toContain('hunter22secret')
    expect(result.content).toContain('[redacted]')
  })

  it('returns a placeholder instead of content for oversized files', async () => {
    existingFiles('cypress.config.ts')
    mockStat.mockResolvedValue({ size: 10_000_000 } as never)

    const result = await getConfig(PROJECT_ROOT)
    expect(result.file).toBe('cypress.config.ts')
    expect(result.content).toContain('File too large')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('tries the next filename when the file vanishes between resolve and read (race)', async () => {
    existingFiles('cypress.config.ts', 'cypress.config.js')
    mockReadFile
      .mockRejectedValueOnce(enoent() as never)
      .mockResolvedValueOnce('module.exports = {}' as never)

    const result = await getConfig(PROJECT_ROOT)
    expect(result.file).toBe('cypress.config.js')
    expect(result.content).toBe('module.exports = {}')
  })

  it('throws when the config resolves outside the project root via symlink', async () => {
    // Root resolves to itself; config file symlinks outside the project
    mockRealpath.mockImplementation(async (p) => {
      const str = p.toString()
      if (str === path.resolve(PROJECT_ROOT)) return str
      return '/etc/evil.ts'
    })

    await expect(getConfig(PROJECT_ROOT)).rejects.toThrow(
      'Path escapes project root via symlink',
    )
  })

  it('rethrows non-ENOENT read errors', async () => {
    existingFiles('cypress.config.ts')
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('EACCES'), { code: 'EACCES' }) as never,
    )

    await expect(getConfig(PROJECT_ROOT)).rejects.toThrow('EACCES')
  })
})
