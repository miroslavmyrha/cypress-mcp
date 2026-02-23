import { REDACT_COMMANDS } from '../utils/constants.js'
import { readLastRunData } from '../utils/read-last-run.js'

const NO_RESULTS_MESSAGE = 'No test results yet. Run Cypress tests first (cypress open or cypress run).'

export async function getLastRun(projectRoot: string, failedOnly = false): Promise<string> {
  const result = await readLastRunData(projectRoot)

  if (!result.ok) {
    // Preserve the original no-results message for ENOENT
    if (result.error.startsWith('No test results')) return NO_RESULTS_MESSAGE
    return result.error
  }

  const data = result.data

  // MCP10: redact sensitive command values from ALL tests.
  // Sensitive commands log actual values (passwords, PII, tokens).
  // Failed tests get a hint (command name) for debugging; passing tests get generic '[redacted]'.
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
