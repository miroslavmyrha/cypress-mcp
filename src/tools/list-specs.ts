import { glob } from 'glob'
import path from 'node:path'

// Multiple patterns instead of brace expansion — nobrace:true disables {ts,js,...} syntax
const DEFAULT_PATTERNS = ['**/*.cy.ts', '**/*.cy.js', '**/*.cy.tsx', '**/*.cy.jsx']
const IGNORE_PATTERNS = ['node_modules/**', 'dist/**', '.git/**']

export async function listSpecs(projectRoot: string, pattern?: string): Promise<string[]> {
  const patterns = pattern ? [pattern] : DEFAULT_PATTERNS

  const matches = await glob(patterns, {
    cwd: projectRoot,
    ignore: IGNORE_PATTERNS,
    nodir: true,
    follow: false,
    nobrace: true, // defense-in-depth: schema blocks { but disable brace expansion at glob level too
  })

  return matches.sort().map((p) => path.normalize(p))
}
