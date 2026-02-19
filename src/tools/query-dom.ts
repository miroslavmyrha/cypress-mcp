import { readFile, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { parse, type HTMLElement } from 'node-html-parser'
import { z } from 'zod'

const LAST_RUN_FILE = '.cypress-mcp/last-run.json'
const SNAPSHOTS_SUBDIR = 'snapshots'
const MAX_QUERY_RESULTS = 5
const MAX_ELEMENT_BYTES = 5_000
const MAX_ELEMENT_LABEL_CHARS = 200 // M6: prevent huge class attribute from blowing up breadcrumb
const MAX_BREADCRUMB_CHARS = 500   // M6: cap total breadcrumb output
const MAX_BREADCRUMB_DEPTH = 50    // M6: limit ancestor traversal depth
const MAX_SNAPSHOT_FILE_BYTES = 2 * 1_024 * 1_024 // M6: 2 MB HTML cap (prevents O(N²) :nth-child DoS)
const MAX_LAST_RUN_BYTES = 50 * 1_024 * 1_024 // F7: 50 MB — same cap as get-last-run.ts
const MAX_SELECTOR_LENGTH = 512    // L4: block excessively long selectors
const DANGEROUS_TAGS = 'script, style, noscript' // H8: tags to strip before querying
const BLOCKED_PSEUDOS = [':has(', ':contains(', ':icontains('] // F11: DoS / text-probing vectors

// H3: runtime schema — only validate fields we access, preserve others with passthrough()
const RunDataSchema = z
  .object({
    specs: z
      .array(
        z
          .object({
            spec: z.string(),
            tests: z
              .array(
                z
                  .object({
                    title: z.string(),
                    domSnapshotPath: z.string().nullable().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

function elementLabel(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase() ?? ''
  const id = el.id ? `#${el.id}` : ''
  const rawClass = el.getAttribute('class') ?? ''
  const classes = rawClass.trim() ? `.${rawClass.trim().split(/\s+/).join('.')}` : ''
  const label = `${tag}${id}${classes}` || '(unknown)'
  return label.slice(0, MAX_ELEMENT_LABEL_CHARS) // M6: cap per-element label
}

function buildBreadcrumb(el: HTMLElement): string {
  const parts: string[] = []
  let current: HTMLElement | null = el
  let depth = 0
  while (current?.tagName && depth < MAX_BREADCRUMB_DEPTH) { // M6: depth limit
    parts.unshift(elementLabel(current))
    current = current.parentNode as HTMLElement | null
    depth++
  }
  return parts.join(' > ').slice(0, MAX_BREADCRUMB_CHARS) // M6: cap total output
}

export async function queryDom(
  projectRoot: string,
  spec: string,
  testTitle: string,
  selector: string,
): Promise<string> {
  // L4: reject excessively long selectors before touching the DOM parser
  if (selector.length > MAX_SELECTOR_LENGTH) {
    return `Error: selector too long (max ${MAX_SELECTOR_LENGTH} characters)`
  }

  // F11: block pseudo-selectors that cause exponential traversal (:has) or text probing (:contains)
  const selectorLower = selector.toLowerCase()
  for (const pseudo of BLOCKED_PSEUDOS) {
    if (selectorLower.includes(pseudo)) {
      return `Error: selector "${pseudo}" is not allowed for security reasons.`
    }
  }

  // F6: normalize projectRoot to prevent containment-check bypass with trailing slashes or relative segments
  const normalizedRoot = path.resolve(projectRoot)
  const runFile = path.join(normalizedRoot, LAST_RUN_FILE)
  const mcpDir = path.join(normalizedRoot, '.cypress-mcp')
  const snapshotsDir = path.join(mcpDir, SNAPSHOTS_SUBDIR)

  // M9: resolve symlinks on last-run.json before reading
  let realRunFile: string
  try {
    realRunFile = await realpath(runFile)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'No test results found. Run Cypress tests first.'
    throw err
  }

  // F4: re-validate that realpath of last-run.json stays within project root
  if (!realRunFile.startsWith(normalizedRoot + path.sep)) {
    return 'Error: last-run.json is a symlink outside the project directory'
  }

  // F7: size check before reading — same 50 MB cap as get-last-run.ts
  const runFileStat = await stat(realRunFile)
  if (runFileStat.size > MAX_LAST_RUN_BYTES) {
    return 'Error: last-run.json exceeds size limit'
  }

  // H3: validate structure at runtime
  let data: z.infer<typeof RunDataSchema>
  try {
    const content = await readFile(realRunFile, 'utf-8')
    const schemaResult = RunDataSchema.safeParse(JSON.parse(content))
    if (!schemaResult.success) {
      return 'Error: last-run.json has unexpected structure.'
    }
    data = schemaResult.data
  } catch {
    return 'Error: failed to read or parse last-run.json.'
  }

  // Find the test entry — model provides spec + testTitle, never a raw path
  const specEntry = data.specs?.find((s) => s.spec === spec)
  if (!specEntry) return `Spec not found: ${spec}`

  const testEntry = specEntry.tests?.find((t) => t.title === testTitle)
  if (!testEntry) return `Test not found: ${testTitle}`

  if (!testEntry.domSnapshotPath) {
    return 'No DOM snapshot for this test. Snapshots are only captured for failed tests.'
  }

  // Security: validate resolved path stays within snapshotsDir (prevents path traversal)
  const resolved = path.resolve(mcpDir, testEntry.domSnapshotPath)
  if (!resolved.startsWith(snapshotsDir + path.sep)) {
    return 'Error: invalid snapshot path'
  }

  // M9: also resolve symlinks on the snapshot file itself and re-validate
  let html: string
  try {
    const realSnapshot = await realpath(resolved)
    if (!realSnapshot.startsWith(snapshotsDir + path.sep)) {
      return 'Error: snapshot is a symlink outside the snapshots directory'
    }

    // M6: file size limit before parsing — prevents O(N²) :nth-child DoS on large DOMs
    const snapshotStat = await stat(realSnapshot)
    if (snapshotStat.size > MAX_SNAPSHOT_FILE_BYTES) {
      return `Error: snapshot file too large (${snapshotStat.size} bytes). DOM snapshot may be oversized.`
    }

    html = await readFile(realSnapshot, 'utf-8')
  } catch {
    return 'Snapshot file not found. It may have been deleted.'
  }

  const root = parse(html)

  // H8: strip dangerous elements from the DOM tree before querying —
  // more reliable than regex sanitization (handles unclosed tags, nested contexts)
  const dangerousTags = root.querySelectorAll(DANGEROUS_TAGS)
  for (const el of dangerousTags) {
    el.remove()
  }

  // L4: wrap querySelectorAll — invalid selectors throw from the css-what parser
  let matches: HTMLElement[]
  try {
    matches = root.querySelectorAll(selector)
  } catch (err) {
    return `Invalid CSS selector: ${err instanceof Error ? err.message : String(err)}`
  }

  if (matches.length === 0) {
    return `No elements found matching selector: ${selector}`
  }

  const truncated = matches.length > MAX_QUERY_RESULTS
  const results = matches.slice(0, MAX_QUERY_RESULTS).map((el, i) => {
    const breadcrumb = buildBreadcrumb(el)
    const raw = el.outerHTML
    const isTruncated = raw.length > MAX_ELEMENT_BYTES
    return {
      index: i,
      breadcrumb,
      outerHTML: isTruncated ? `${raw.slice(0, MAX_ELEMENT_BYTES)}<!-- truncated -->` : raw,
    }
  })

  return JSON.stringify(
    {
      selector,
      totalMatches: matches.length,
      showing: results.length,
      truncated,
      results,
    },
    null,
    2,
  )
}
