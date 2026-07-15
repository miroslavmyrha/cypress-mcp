import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs/promises')

import { realpath, readFile, stat } from 'node:fs/promises'
import { MAX_SCREENSHOT_EMBED_BYTES } from '../../utils/constants.js'
import { getScreenshot } from '../get-screenshot.js'

const mockStat = vi.mocked(stat)
const mockReadFile = vi.mocked(readFile)
const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'
const FAKE_PNG = Buffer.from('fake-png-bytes')

beforeEach(() => {
  vi.clearAllMocks()
  // By default, realpath returns the resolved path unchanged (no symlinks)
  mockRealpath.mockImplementation(async (p) => p.toString())
  mockReadFile.mockResolvedValue(FAKE_PNG as never)
})

describe('getScreenshot', () => {
  it('throws when screenshot path is outside the project root', async () => {
    await expect(getScreenshot(PROJECT_ROOT, '/etc/shadow.png')).rejects.toThrow(
      'Path must be within the project root',
    )
  })

  it('throws when symlink resolves outside project root', async () => {
    // Root resolves to itself; only file symlink resolves outside project
    mockRealpath.mockImplementation(async (p) => {
      const str = p.toString()
      if (str === path.resolve(PROJECT_ROOT)) return str
      return '/etc/shadow'
    })

    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/evil-link.png`),
    ).rejects.toThrow('Path escapes project root via symlink')
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

  it('embeds the image as base64 with the correct mime type', async () => {
    mockStat.mockResolvedValue({ size: FAKE_PNG.length } as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/login.png`,
    )
    expect(result.image).toEqual({
      data: FAKE_PNG.toString('base64'),
      mimeType: 'image/png',
    })
  })

  it('uses image/jpeg mime type for .jpg and .jpeg files', async () => {
    mockStat.mockResolvedValue({ size: 100 } as never)

    for (const ext of ['.jpg', '.jpeg']) {
      const result = await getScreenshot(
        PROJECT_ROOT,
        `${PROJECT_ROOT}/cypress/screenshots/photo${ext}`,
      )
      expect(result.image?.mimeType).toBe('image/jpeg')
    }
  })

  it('returns metadata only with a note when the file exceeds the embed limit', async () => {
    mockStat.mockResolvedValue({ size: MAX_SCREENSHOT_EMBED_BYTES + 1 } as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/huge.png`,
    )
    expect(result.exists).toBe(true)
    expect(result.sizeBytes).toBe(MAX_SCREENSHOT_EMBED_BYTES + 1)
    expect(result.image).toBeNull()
    expect(result.note).toContain('not embedded')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('embeds a file exactly at the embed limit', async () => {
    mockStat.mockResolvedValue({ size: MAX_SCREENSHOT_EMBED_BYTES } as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/limit.png`,
    )
    expect(result.image).not.toBeNull()
    expect(result.note).toBeUndefined()
  })

  it('returns exists:false when the file vanishes between stat and read (race)', async () => {
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockStat.mockResolvedValue({ size: 100 } as never)
    mockReadFile.mockRejectedValue(enoentErr as never)

    const result = await getScreenshot(
      PROJECT_ROOT,
      `${PROJECT_ROOT}/cypress/screenshots/vanished.png`,
    )
    expect(result.exists).toBe(false)
    expect(result.sizeBytes).toBeNull()
    expect(result.image).toBeNull()
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
    expect(result.image).toBeNull()
  })

  it('rejects non-existent file outside project root (ENOENT + containment)', async () => {
    // HIGH-2: when resolveSecurePath throws ENOENT, the fallback path must still
    // enforce containment — otherwise a non-existent path outside projectRoot
    // could bypass the security check.
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockRealpath.mockRejectedValue(enoentErr as never)

    await expect(
      getScreenshot(PROJECT_ROOT, '/etc/nonexistent.png'),
    ).rejects.toThrow('Path must be within the project root')
  })

  it('rethrows non-ENOENT stat errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockStat.mockRejectedValue(err as never)

    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/protected.png`),
    ).rejects.toThrow('EACCES')
  })

  it('rethrows non-ENOENT read errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    mockStat.mockResolvedValue({ size: 100 } as never)
    mockReadFile.mockRejectedValue(err as never)

    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/cypress/screenshots/protected.png`),
    ).rejects.toThrow('EACCES')
  })

  it('rejects path traversal disguised as absolute path within project', async () => {
    // A path that looks internal but resolves outside
    await expect(
      getScreenshot(PROJECT_ROOT, `${PROJECT_ROOT}/../outside/secret.png`),
    ).rejects.toThrow('Path must be within the project root')
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
