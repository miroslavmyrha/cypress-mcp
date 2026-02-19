import { readFile, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const LAST_RUN_FILE = '.cypress-mcp/last-run.json'
const NO_RESULTS_MESSAGE = 'No test results yet. Run Cypress tests first (cypress open or cypress run).'

// H2: prevent OOM from reading a multi-GB file into memory before JSON.parse
const MAX_LAST_RUN_BYTES = 50 * 1_024 * 1_024 // 50 MB

// H3: runtime schema validation — TypeScript casts provide zero runtime protection.
// Using .passthrough() at each level preserves extra fields in the returned JSON.
const RunDataSchema = z
  .object({
    specs: z
      .array(
        z
          .object({
            tests: z
              .array(
                z
                  .object({ state: z.string() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

export async function getLastRun(projectRoot: string, failedOnly = false): Promise<string> {
  const filePath = path.join(projectRoot, LAST_RUN_FILE)

  // M9: resolve symlinks — readFile follows them silently, which enables symlink attacks
  let realFilePath: string
  try {
    realFilePath = await realpath(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return NO_RESULTS_MESSAGE
    throw err
  }

  if (!realFilePath.startsWith(path.resolve(projectRoot) + path.sep)) {
    return 'Error: last-run.json is a symlink outside the project root.'
  }

  // H2: size check before allocating file contents + JSON parse buffer
  const fileStat = await stat(realFilePath)
  if (fileStat.size > MAX_LAST_RUN_BYTES) {
    return `Error: last-run.json is too large (${fileStat.size} bytes). The file may be corrupted.`
  }

  let parsed: unknown
  try {
    const content = await readFile(realFilePath, 'utf-8')
    parsed = JSON.parse(content)
  } catch (err) {
    if (err instanceof SyntaxError) {
      return 'Error: last-run.json contains invalid JSON. The file may be corrupted or still being written.'
    }
    throw err
  }

  // H3: validate structure at runtime — prevents TypeError crashes on tampered/malformed files
  const schemaResult = RunDataSchema.safeParse(parsed)
  if (!schemaResult.success) {
    return 'Error: last-run.json has unexpected structure. The file may be corrupted.'
  }

  const data = schemaResult.data

  // MCP10: redact sensitive command values from ALL tests.
  // Sensitive commands log actual values (passwords, PII, tokens).
  // Failed tests get a hint (command name) for debugging; passing tests get generic '[redacted]'.
  const REDACT_COMMANDS = new Set(['type', 'clear', 'request', 'setCookie', 'session', 'invoke', 'its'])
  type AnyRecord = Record<string, unknown>
  type CommandRecord = { name: string; message: string }

  function redactTestCommands(specs: AnyRecord[]): AnyRecord[] {
    return specs.map((spec) => ({
      ...spec,
      tests: ((spec.tests as AnyRecord[] | undefined) ?? []).map((test) => {
        const cmds = (test.commands as CommandRecord[] | undefined) ?? []
        return {
          ...test,
          commands: cmds.map((cmd) => {
            if (REDACT_COMMANDS.has(cmd.name)) {
              return {
                ...cmd,
                message: test.state === 'failed'
                  ? `[redacted - ${cmd.name}]` // hint for debugging
                  : '[redacted]',
              }
            }
            return cmd
          }),
        }
      }),
    }))
  }

  if (failedOnly) {
    const filtered = {
      ...data,
      specs: redactTestCommands(
        (data.specs ?? [])
          .map((spec) => ({
            ...spec,
            tests: (spec.tests ?? []).filter((t) => t.state === 'failed'),
          }))
          .filter((spec) => (spec.tests ?? []).length > 0),
      ),
    }
    return JSON.stringify(filtered, null, 2)
  }

  return JSON.stringify(
    { ...data, specs: redactTestCommands(data.specs ?? []) },
    null,
    2,
  )
}
