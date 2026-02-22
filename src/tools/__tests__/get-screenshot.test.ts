import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { realpath, stat } from 'node:fs/promises'
import { getScreenshot } from '../get-screenshot.js'

const mockStat = vi.mocked(stat)
const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
  // By default, realpath returns the resolved path unchanged (no symlinks)
  mockRealpath.mockImplementation(async (p) => p.toString())
})

describe('getScreenshot', () => {
  it('throws when screenshot path is outside the project root', async () => {
    await expect(getScreenshot(PROJECT_ROOT, '/etc/shadow')).rejects.toThrow(
      'Screenshot path must be within the project root',
    )
  })

  it('throws when symlink resolves outside project root', async () => {
    mockRealpath.mockResolvedValue('/etc/shadow' as never)

    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/evil-link.png`),
    ).rejects.toThrow('Screenshot path must be within the project root')
  })

  it('throws when file extension is not an allowed image type', async () => {
    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/data.json`),
    ).rejects.toThrow('File extension not allowed')
  })

  it('returns exists:true with file size when file is found', async () => {
    mockStat.mockResolvedValue({ size: 12345 } as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/login.png`,
    )
    expect(result.exists).toBe(true)
    expect(result.sizeBytes).toBe(12345)
  })

  it('returns exists:false with null size when file does not exist (ENOENT)', async () => {
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    // realpath throws ENOENT for non-existent files — this is expected
    mockRealpath.mockRejectedValue(enoentErr as never)
    mockStat.mockRejectedValue(enoentErr as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/missing.png`,
    )
    expect(result.exists).toBe(false)
    expect(result.sizeBytes).toBeNull()
  })

  it('rethrows non-ENOENT stat errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockStat.mockRejectedValue(err as never)

    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/protected.png`),
    ).rejects.toThrow('EACCES')
  })

  it('rejects path traversal disguised as absolute path within project', async () => {
    // A path that looks internal but resolves outside
    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/../outside/secret.png`),
    ).rejects.toThrow('Screenshot path must be within the project root')
  })

  it.each(['.png', '.jpg', '.jpeg'])('allows %s extension', async (ext) => {
    mockStat.mockResolvedValue({ size: 1000 } as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/image${ext}`,
    )
    expect(result.exists).toBe(true)
  })
})
