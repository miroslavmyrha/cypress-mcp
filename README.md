# cypress-mcp

MCP server that connects Claude to your Cypress test runner. Claude can read your spec files and see exactly what happened in the last test run — which commands ran, what failed, error messages, and DOM snapshots.

## How it works

```
cypress open → test runs in browser
  → support/index.ts captures Cypress command log per test
  → cy.task('mcpSaveTestLog') transfers logs to node side
  → plugin/index.ts stores logs in memory
  → after:spec → merges logs + results → writes .cypress-mcp/last-run.json

Claude → MCP server → get_last_run → reads last-run.json
```

## Setup

### 1. Install

```bash
npm install -D cypress-mcp
```

### 2. Register the plugin — `cypress.config.ts`

```typescript
import { defineConfig } from 'cypress'
import { cypressMcpPlugin } from 'cypress-mcp/plugin'

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      cypressMcpPlugin(on, config)
    },
  },
})
```

### 3. Import support — `cypress/support/e2e.ts`

```typescript
import 'cypress-mcp/support'
```

### 4a. Configure Claude Desktop / Claude Code (stdio transport)

In your MCP settings (`~/.config/claude/claude_desktop_config.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["cypress-mcp", "--project", "/absolute/path/to/your/project"]
    }
  }
}
```

Or with `claude mcp add`:
```bash
claude mcp add cypress -- npx cypress-mcp --project /absolute/path/to/your/project
```

### 4b. HTTP transport (Ollama, custom bridges)

```bash
# Start MCP server in HTTP mode (random token printed to stderr)
npx cypress-mcp --project /path/to/project --transport http --port 3333

# Or with a fixed token for automated deployments
MCP_HTTP_TOKEN=$(openssl rand -hex 32) npx cypress-mcp --project /path/to/project --transport http --port 3333

# Server listens on:
#   POST http://localhost:3333/mcp  → tool calls (MCP Streamable HTTP)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_specs` | List all Cypress spec files. Optional `pattern` glob (default: `**/*.cy.{ts,js,tsx,jsx}`) |
| `read_spec` | Read a spec file's content by relative path |
| `get_last_run` | Get results of the last test run: states, errors, command log, DOM snapshots |
| `get_screenshot` | Get info about a screenshot file: path, exists, size |
| `query_dom` | Query the DOM snapshot of a failed test using a CSS selector |
| `run_spec` | Run a single Cypress spec file and wait for completion. Returns exit code and summary |

## Output format — `.cypress-mcp/last-run.json`

```json
{
  "timestamp": "2026-02-18T22:00:00Z",
  "specs": [
    {
      "spec": "cypress/e2e/login.cy.ts",
      "stats": { "passes": 3, "failures": 1, "pending": 0, "skipped": 0, "duration": 5230 },
      "screenshots": ["/abs/path/to/Login -- should show error (failed).png"],
      "tests": [
        {
          "title": "Login > should login with valid credentials",
          "state": "passed",
          "duration": 1200,
          "error": null,
          "domSnapshotPath": null,
          "commands": [
            { "name": "visit", "message": "/login" },
            { "name": "get", "message": "#email" },
            { "name": "type", "message": "test@example.com" }
          ],
          "consoleErrors": [],
          "networkErrors": []
        },
        {
          "title": "Login > should show error on invalid password",
          "state": "failed",
          "duration": 800,
          "error": "Timed out retrying: Expected to find element: .error-message",
          "domSnapshotPath": "snapshots/cypress-e2e-login-cy-ts/login--should-show-error-a1b2c3.html",
          "commands": [...],
          "consoleErrors": ["Uncaught TypeError: Cannot read property 'x' of null"],
          "networkErrors": [{ "method": "POST", "url": "/api/login", "status": 500 }]
        }
      ]
    },
    {
      "spec": "cypress/e2e/dashboard.cy.ts",
      "stats": { ... },
      "screenshots": [],
      "tests": [...]
    }
  ]
}
```

All specs from a run are captured. In `cypress run` the accumulator resets on `before:run`. In `cypress open` results accumulate for the lifetime of the Cypress process. Failed tests include a `domSnapshotPath` pointing to an HTML file (up to 100 KB of `document.body.outerHTML`) stored under `.cypress-mcp/snapshots/`.

## CLI options

```
Options:
  --project <path>     Cypress project root (default: current directory)
  --transport <type>   stdio or http (default: stdio)
  --port <number>      HTTP port, only for --transport http (default: 3333)
  -V, --version        Show version
  -h, --help           Show help
```

## Add `.cypress-mcp` to `.gitignore`

```gitignore
.cypress-mcp/
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `MCP_HTTP_TOKEN` | Set a fixed bearer token for HTTP transport (min 32 chars). If not set, a random token is generated on each start and printed to stderr. |

## Development

This project uses [Bun](https://bun.sh/) as the package manager:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

## Requirements

- Node.js 18+
- Cypress 12+

## Author

Miroslav Myrha

## License

MIT
