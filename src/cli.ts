import { Command } from 'commander'
import { startServer } from './server.js'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf-8')) as { version: string }

new Command()
  .name('cypress-mcp')
  .description('MCP server for Cypress — gives Claude access to spec files and test results')
  .version(pkg.version)
  .option('--project <path>', 'Cypress project root', process.cwd())
  .option('--transport <type>', 'Transport type: stdio (default) or http', 'stdio')
  .option('--port <number>', 'HTTP port (only for --transport http)', '3333')
  .action(({ project, transport, port }: { project: string; transport: string; port: string }) => {
    const VALID_TRANSPORTS = ['stdio', 'http'] as const
    if (!VALID_TRANSPORTS.includes(transport as (typeof VALID_TRANSPORTS)[number])) {
      process.stderr.write(
        `Error: Invalid transport "${transport}". Must be one of: ${VALID_TRANSPORTS.join(', ')}\n`,
      )
      process.exit(1)
    }

    startServer({
      projectRoot: path.resolve(project),
      transport: transport as 'stdio' | 'http',
      port: Number(port),
    })
  })
  .parse()
