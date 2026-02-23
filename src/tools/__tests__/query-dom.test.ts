import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

vi.mock('node:fs/promises')

import { readFile, stat, realpath } from 'node:fs/promises'
import { queryDom } from '../query-dom.js'

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)
const mockRealpath = vi.mocked(realpath)

const PROJECT_ROOT = '/fake/project'
const MCP_DIR = `${PROJECT_ROOT}/.cypress-mcp`
const SNAPSHOTS_DIR = `${MCP_DIR}/snapshots`
const RUN_FILE = `${MCP_DIR}/last-run.json`

const SPEC = 'cypress/e2e/login.cy.ts'
const TEST_TITLE = 'login > should login'

// specSlug('cypress/e2e/login.cy.ts') = 'cypress-e2e-login-cy-ts'
const SLUG = 'cypress-e2e-login-cy-ts'
// testFilename uses SHA-256 hash, but the domSnapshotPath comes from the JSON data — we set it manually
const SNAPSHOT_REL = `snapshots/${SLUG}/should-login-abcd1234.html`
const SNAPSHOT_ABS = path.join(MCP_DIR, SNAPSHOT_REL)

function makeRunData(domSnapshotPath: string | null = SNAPSHOT_REL) {
  return JSON.stringify({
    timestamp: '2024-01-01T00:00:00.000Z',
    specs: [
      {
        spec: SPEC,
        tests: [{ title: TEST_TITLE, state: 'failed', domSnapshotPath }],
      },
    ],
  })
}

function setupValidQuery(html = '<div id="app"><button class="btn">Click</button></div>') {
  // Default realpath mock (returns input) handles root + file resolution
  mockReadFile
    .mockResolvedValueOnce(makeRunData() as never) // last-run.json content
    .mockResolvedValueOnce(html as never) // snapshot HTML
  mockStat.mockResolvedValue({ size: 1000 } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: realpath returns input unchanged (resolveSecurePath resolves root + file)
  mockRealpath.mockImplementation(async (p) => p.toString())
})

describe('queryDom', () => {
  it('rejects selectors exceeding 512 characters (L4)', async () => {
    const longSelector = 'div.' + 'x'.repeat(520)
    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, longSelector)
    expect(result).toMatch(/selector too long/)
  })

  it('returns message when last-run.json does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockRealpath.mockRejectedValue(err as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/No test results yet/)
  })

  it('rejects symlink on last-run.json that resolves outside project root (F4)', async () => {
    mockRealpath.mockImplementation(async (p) => {
      const str = p.toString()
      if (str === path.resolve(PROJECT_ROOT)) return str
      return '/etc/evil/last-run.json'
    })

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/symlink outside the project root/)
  })

  it('rejects last-run.json exceeding 5 MB size limit (F7)', async () => {
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 6 * 1024 * 1024 } as never) // 6 MB

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/too large/)
    // readFile should NOT be called
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('normalizes projectRoot with trailing slash for containment check (F6)', async () => {
    // Use a projectRoot with trailing slash — path.resolve() strips it
    const trailingSlashRoot = '/fake/project/'
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 100 } as never)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ specs: [{ spec: SPEC, tests: [{ title: TEST_TITLE, state: 'failed', domSnapshotPath: null }] }] }) as never,
    )

    // Should NOT return symlink error — the normalized root matches
    const result = await queryDom(trailingSlashRoot, SPEC, TEST_TITLE, 'button')
    expect(result).not.toMatch(/symlink outside/)
  })

  it('rejects path traversal in domSnapshotPath', async () => {
    const traversalPath = '../../../etc/passwd'
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 100 } as never)
    mockReadFile.mockResolvedValueOnce(makeRunData(traversalPath) as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/invalid snapshot path/)
  })

  it('rejects symlink that resolves outside snapshots directory (double-symlink M9)', async () => {
    // Root and last-run.json resolve normally; only snapshot symlink resolves outside
    mockRealpath.mockImplementation(async (p) => {
      const str = p.toString()
      if (str === SNAPSHOT_ABS) return '/etc/outside.html'
      return str
    })
    mockReadFile.mockResolvedValueOnce(makeRunData() as never)
    mockStat.mockResolvedValue({ size: 100 } as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/symlink outside the snapshots directory/)
  })

  it('rejects snapshot files exceeding 2 MB (M6)', async () => {
    // Default realpath mock handles all resolution
    mockReadFile.mockResolvedValueOnce(makeRunData() as never)
    mockStat.mockResolvedValue({ size: 3 * 1024 * 1024 } as never) // 3 MB — passes 5 MB last-run check, fails 2 MB snapshot check

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/snapshot file too large/)
  })

  it('returns message when spec is not found in run data', async () => {
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 100 } as never)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ specs: [{ spec: 'other.cy.ts', tests: [] }] }) as never,
    )

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/Spec file not found/)
  })

  it('returns message when test title is not found in spec', async () => {
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 100 } as never)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        specs: [{ spec: SPEC, tests: [{ title: 'other test', state: 'passed', domSnapshotPath: null }] }],
      }) as never,
    )

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/Test not found/)
  })

  it('returns message when test has no DOM snapshot', async () => {
    // Default realpath mock handles root + file resolution
    mockStat.mockResolvedValueOnce({ size: 100 } as never)
    mockReadFile.mockResolvedValueOnce(makeRunData(null) as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/No DOM snapshot/)
  })

  it('returns error message for invalid CSS selector', async () => {
    setupValidQuery('<div></div>')

    // node-html-parser may or may not throw on invalid selectors; use a known bad selector
    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, '::invalid-pseudo')
    // Either "Invalid CSS selector" or "No elements found" — both are acceptable
    expect(result).toMatch(/Invalid CSS selector|No elements found/)
  })

  it('returns message when no elements match selector', async () => {
    setupValidQuery('<div><span>text</span></div>')

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/No elements found/)
  })

  it('returns matched elements with breadcrumb and outerHTML', async () => {
    setupValidQuery('<div id="app"><button class="btn">Click</button></div>')

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    const data = JSON.parse(result)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].outerHTML).toContain('<button')
    expect(data.results[0].breadcrumb).toContain('button')
  })

  it('rejects selector containing :has( for security (F11)', async () => {
    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, '*:has(div)')
    expect(result).toMatch(/":has\(" is not allowed for security reasons/)
  })

  it('rejects selector containing :has( case-insensitively (F11)', async () => {
    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, '*:HAS(div)')
    expect(result).toMatch(/":has\(" is not allowed for security reasons/)
  })

  it('rejects selector containing :contains( for security (F11)', async () => {
    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'div:contains(secret)')
    expect(result).toMatch(/":contains\(" is not allowed for security reasons/)
  })

  it.each([
    { tag: 'script', html: '<div><script>alert("xss")</script><p>safe</p></div>' },
    { tag: 'style', html: '<div><style>body{display:none}</style><p>visible</p></div>' },
    { tag: 'noscript', html: '<div><noscript>Enable JS</noscript><p>content</p></div>' },
  ])('strips <$tag> elements so selector "$tag" returns no results (H8)', async ({ tag, html }) => {
    setupValidQuery(html)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, tag)
    expect(result).toMatch(/No elements found/)
  })

  it('still returns safe elements after dangerous tag stripping (H8)', async () => {
    setupValidQuery('<div><script>bad</script><button class="btn">Click</button></div>')

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    const data = JSON.parse(result)
    expect(data.results).toHaveLength(1)
    expect(data.results[0].outerHTML).toContain('<button')
  })

  it('limits results to MAX_QUERY_RESULTS (5) when more elements match', async () => {
    const buttons = Array.from({ length: 10 }, (_, i) => `<button id="b${i}">B${i}</button>`)
    setupValidQuery(`<div>${buttons.join('')}</div>`)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    const data = JSON.parse(result)
    expect(data.showing).toBe(5)
    expect(data.totalMatches).toBe(10)
    expect(data.truncated).toBe(true)
  })
})
