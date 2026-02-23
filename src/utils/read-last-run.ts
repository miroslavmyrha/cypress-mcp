import { readFile, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { LAST_RUN_FILE, MAX_LAST_RUN_BYTES } from './constants.js'

// H3: runtime schema — superset of fields needed by get-last-run and query-dom.
// Using .passthrough() at each level preserves extra fields in the returned JSON.
export const RunDataSchema = z
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
                    state: z.string(),
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

export type RunData = z.infer<typeof RunDataSchema>

/**
 * Read, validate, and return the last-run.json data.
 * Performs: realpath → containment check → size check → readFile → JSON.parse → Zod validate.
 */
export async function readLastRunData(
  projectRoot: string,
): Promise<{ ok: true; data: RunData } | { ok: false; error: string }> {
  const normalizedRoot = path.resolve(projectRoot)
  const filePath = path.join(normalizedRoot, LAST_RUN_FILE)

  // M9: resolve symlinks — readFile follows them silently, which enables symlink attacks
  let realFilePath: string
  try {
    realFilePath = await realpath(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: false, error: 'No test results yet. Run Cypress tests first (cypress open or cypress run).' }
    }
    throw err
  }

  if (!realFilePath.startsWith(normalizedRoot + path.sep)) {
    return { ok: false, error: 'Error: last-run.json is a symlink outside the project root.' }
  }

  // H2: size check before allocating file contents + JSON parse buffer
  const fileStat = await stat(realFilePath)
  if (fileStat.size > MAX_LAST_RUN_BYTES) {
    return {
      ok: false,
      error: `Error: last-run.json is too large (${fileStat.size} bytes). The file may be corrupted.`,
    }
  }

  let parsed: unknown
  try {
    const content = await readFile(realFilePath, 'utf-8')
    parsed = JSON.parse(content)
  } catch (err) {
    if (err instanceof SyntaxError) {
      return {
        ok: false,
        error: 'Error: last-run.json contains invalid JSON. The file may be corrupted or still being written.',
      }
    }
    throw err
  }

  // H3: validate structure at runtime — prevents TypeError crashes on tampered/malformed files
  const schemaResult = RunDataSchema.safeParse(parsed)
  if (!schemaResult.success) {
    return { ok: false, error: 'Error: last-run.json has unexpected structure. The file may be corrupted.' }
  }

  return { ok: true, data: schemaResult.data }
}
