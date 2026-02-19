import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises')

import { stat } from 'node:fs/promises'
import { getScreenshot } from '../get-screenshot.js'

const mockStat = vi.mocked(stat)

const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getScreenshot', () => {
  it('throws when screenshot path is outside the project root', async () => {
    await expect(getScreenshot(PROJECT_ROOT, '/etc/shadow')).rejects.toThrow(
      'Screenshot path must be within the project root',
    )
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
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockStat.mockRejectedValue(err as never)

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
})
