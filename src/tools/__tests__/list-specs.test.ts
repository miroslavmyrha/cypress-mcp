import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('glob')

import { glob } from 'glob'
import { listSpecs } from '../list-specs.js'

const mockGlob = vi.mocked(glob)
const PROJECT_ROOT = '/fake/project'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listSpecs', () => {
  it('uses default pattern when none is provided', async () => {
    mockGlob.mockResolvedValue([] as never)
    await listSpecs(PROJECT_ROOT)
    expect(mockGlob).toHaveBeenCalledWith(
      '**/*.cy.{ts,js,tsx,jsx}',
      expect.objectContaining({ cwd: PROJECT_ROOT }),
    )
  })

  it('uses the provided pattern instead of the default', async () => {
    mockGlob.mockResolvedValue([] as never)
    await listSpecs(PROJECT_ROOT, 'src/**/*.spec.ts')
    expect(mockGlob).toHaveBeenCalledWith(
      'src/**/*.spec.ts',
      expect.any(Object),
    )
  })

  it('returns results sorted alphabetically', async () => {
    mockGlob.mockResolvedValue(['z.cy.ts', 'a.cy.ts', 'm.cy.ts'] as never)
    const result = await listSpecs(PROJECT_ROOT)
    expect(result).toEqual(['a.cy.ts', 'm.cy.ts', 'z.cy.ts'])
  })

  it('ignores node_modules, dist, and .git', async () => {
    mockGlob.mockResolvedValue([] as never)
    await listSpecs(PROJECT_ROOT)
    const ignoreArg = (mockGlob.mock.calls[0][1] as { ignore: string[] }).ignore
    expect(ignoreArg).toContain('node_modules/**')
    expect(ignoreArg).toContain('dist/**')
    expect(ignoreArg).toContain('.git/**')
  })
})
