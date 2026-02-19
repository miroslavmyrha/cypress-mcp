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
  mockRealpath
    .mockResolvedValueOnce(RUN_FILE as never) // last-run.json realpath
    .mockResolvedValueOnce(SNAPSHOT_ABS as never) // snapshot realpath
  mockReadFile
    .mockResolvedValueOnce(makeRunData() as never) // last-run.json content
    .mockResolvedValueOnce(html as never) // snapshot HTML
  mockStat.mockResolvedValue({ size: 1000 } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(result).toMatch(/No test results found/)
  })

  it('rejects path traversal in domSnapshotPath', async () => {
    const traversalPath = '../../../etc/passwd'
    mockRealpath.mockResolvedValueOnce(RUN_FILE as never)
    mockReadFile.mockResolvedValueOnce(makeRunData(traversalPath) as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/invalid snapshot path/)
  })

  it('rejects symlink that resolves outside snapshots directory (double-symlink M9)', async () => {
    mockRealpath
      .mockResolvedValueOnce(RUN_FILE as never)
      .mockResolvedValueOnce('/etc/outside.html' as never) // symlink resolves outside
    mockReadFile.mockResolvedValueOnce(makeRunData() as never)
    mockStat.mockResolvedValue({ size: 100 } as never)

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/symlink outside the snapshots directory/)
  })

  it('rejects snapshot files exceeding 2 MB (M6)', async () => {
    mockRealpath
      .mockResolvedValueOnce(RUN_FILE as never)
      .mockResolvedValueOnce(SNAPSHOT_ABS as never)
    mockReadFile.mockResolvedValueOnce(makeRunData() as never)
    mockStat.mockResolvedValue({ size: 3 * 1024 * 1024 } as never) // 3 MB

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/snapshot file too large/)
  })

  it('returns message when spec is not found in run data', async () => {
    mockRealpath.mockResolvedValueOnce(RUN_FILE as never)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ specs: [{ spec: 'other.cy.ts', tests: [] }] }) as never,
    )

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/Spec not found/)
  })

  it('returns message when test title is not found in spec', async () => {
    mockRealpath.mockResolvedValueOnce(RUN_FILE as never)
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        specs: [{ spec: SPEC, tests: [{ title: 'other test', domSnapshotPath: null }] }],
      }) as never,
    )

    const result = await queryDom(PROJECT_ROOT, SPEC, TEST_TITLE, 'button')
    expect(result).toMatch(/Test not found/)
  })

  it('returns message when test has no DOM snapshot', async () => {
    mockRealpath.mockResolvedValueOnce(RUN_FILE as never)
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
