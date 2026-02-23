import { REDACT_COMMANDS, NO_RESULTS_MESSAGE } from '../utils/constants.js'
import { readLastRunData, type RunData } from '../utils/read-last-run.js'

export async function getLastRun(projectRoot: string, failedOnly = false): Promise<string> {
  const result = await readLastRunData(projectRoot)

  if (!result.ok) {
    // Preserve the original no-results message for ENOENT
    if (result.error === NO_RESULTS_MESSAGE) return NO_RESULTS_MESSAGE
    return result.error
  }

  const data = result.data

  // MCP10: redact sensitive command values from ALL tests.
  // Sensitive commands log actual values (passwords, PII, tokens).
  // Failed tests get a hint (command name) for debugging; passing tests get generic '[redacted]'.
  type Spec = NonNullable<RunData['specs']>[number]
  type Test = NonNullable<Spec['tests']>[number]
  type Command = NonNullable<Test['commands']>[number]

  function redactTestCommands(specs: Spec[]): Spec[] {
    return specs.map((spec) => ({
      ...spec,
      tests: (spec.tests ?? []).map((test) => ({
        ...test,
        commands: (test.commands ?? []).map((cmd: Command) => {
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
      })),
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
