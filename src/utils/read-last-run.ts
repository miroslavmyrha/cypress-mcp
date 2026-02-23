import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { LAST_RUN_FILE, MAX_LAST_RUN_BYTES, NO_RESULTS_MESSAGE } from './constants.js'
import { getErrnoCode } from './errors.js'
import { resolveSecurePath, PathTraversalError } from './path-security.js'

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
                    commands: z.array(z.object({ name: z.string(), message: z.string() }).passthrough()).optional(),
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
 * Performs: resolveSecurePath (containment + symlink) → size check → readFile → JSON.parse → Zod validate.
 */
export async function readLastRunData(
  projectRoot: string,
): Promise<{ ok: true; data: RunData } | { ok: false; error: string }> {
  // Security: containment check + symlink resolution (single source of truth)
  let realFilePath: string
  try {
    realFilePath = await resolveSecurePath(projectRoot, LAST_RUN_FILE)
  } catch (err) {
    if (getErrnoCode(err) === 'ENOENT') {
      return { ok: false, error: NO_RESULTS_MESSAGE }
    }
    if (err instanceof PathTraversalError) {
      return { ok: false, error: 'Error: last-run.json is a symlink outside the project root.' }
    }
    throw err
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
