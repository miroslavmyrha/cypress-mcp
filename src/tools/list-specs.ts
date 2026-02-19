import { glob } from 'glob'
import path from 'node:path'

const DEFAULT_PATTERN = '**/*.cy.{ts,js,tsx,jsx}'
const IGNORE_PATTERNS = ['node_modules/**', 'dist/**', '.git/**']

export async function listSpecs(projectRoot: string, pattern?: string): Promise<string[]> {
  const resolvedPattern = pattern ?? DEFAULT_PATTERN

  const matches = await glob(resolvedPattern, {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    nodir: true,
    follow: false,
  })

  return matches.sort().map((p) => path.normalize(p))
}
