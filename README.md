# cypress-mcp

MCP server that connects Claude to your Cypress test runner. Claude can read your spec files and see exactly what happened in the last test run: which commands ran, what failed, error messages, and DOM snapshots.

## Example

A spec with three tests, the last of which fails:

```js
it('shows a counter of finished items', () => {
  cy.get('.todo-list li').first().find('input[type=checkbox]').check()
  cy.get('[data-test=finished-count]').should('contain', '1')
})
```

After `cypress run`, the assistant calls `get_last_run` and gets the commands that ran, the error and the path of a DOM snapshot (output shortened):

```json
{
  "title": "Todo list > shows a counter of finished items",
  "state": "failed",
  "domSnapshotPath": "snapshots/cypress-e2e-todo-cy-js/todo-list-shows-a-counter-of-finished-items-d963bb8d.html",
  "commands": [
    { "name": "visit", "message": "https://example.cypress.io/todo" },
    { "name": "get", "message": ".todo-list li" },
    { "name": "first", "message": "" },
    { "name": "find", "message": "input[type=checkbox]" },
    { "name": "check", "message": "" },
    { "name": "get", "message": "[data-test=finished-count]" }
  ],
  "error": "AssertionError: Timed out retrying after 2000ms: Expected to find element: `[data-test=finished-count]`, but never found it."
}
```

It can then look into the page as it was when the test failed. `query_dom` with the selector `.todo-count`:

```json
{
  "selector": ".todo-count",
  "totalMatches": 1,
  "results": [
    {
      "breadcrumb": "body > section.todoapp-wrapper > div.todoapp > footer.footer > span.todo-count",
      "outerHTML": "<span class=\"todo-count\"><strong>1</strong> item left</span>"
    }
  ]
}
```

So the counter exists, under another selector, and the assistant can fix the test without anyone pasting logs into the chat.

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

The package is not published to npm yet. Until it is, build it from source and install it from the local folder:

```bash
git clone https://github.com/miroslavmyrha/cypress-mcp.git
cd cypress-mcp && bun install && bun run build

# in your Cypress project
npm install -D /absolute/path/to/cypress-mcp
```

Once it is published, this becomes `npm install -D @miroslavmyrha/cypress-mcp`, and the `npx -y @miroslavmyrha/cypress-mcp` commands below work without the local install.

> Note: the unscoped `cypress-mcp` name on npm belongs to an unrelated project. Always use the scoped `@miroslavmyrha/cypress-mcp`.

### 2. Register the plugin in `cypress.config.ts`

```typescript
import { defineConfig } from 'cypress'
import { cypressMcpPlugin } from '@miroslavmyrha/cypress-mcp/plugin'

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      cypressMcpPlugin(on, config)
    },
  },
})
```

### 3. Import support in `cypress/support/e2e.ts`

```typescript
import '@miroslavmyrha/cypress-mcp/support'
```

### 4a. Configure Claude Desktop / Claude Code (stdio transport)

In your MCP settings (`~/.config/claude/claude_desktop_config.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "cypress": {
      "command": "npx",
      "args": ["-y", "@miroslavmyrha/cypress-mcp", "--project", "/absolute/path/to/your/project"]
    }
  }
}
```

Or with `claude mcp add`:
```bash
claude mcp add cypress -- npx -y @miroslavmyrha/cypress-mcp --project /absolute/path/to/your/project
```

### 4b. HTTP transport (Ollama, custom bridges)

```bash
# Start MCP server in HTTP mode (random token printed to stderr)
npx -y @miroslavmyrha/cypress-mcp --project /path/to/project --transport http --port 3333

# Or with a fixed token for automated deployments
MCP_HTTP_TOKEN=$(openssl rand -hex 32) npx -y @miroslavmyrha/cypress-mcp --project /path/to/project --transport http --port 3333

# Server listens on:
#   POST http://localhost:3333/mcp  → tool calls (MCP Streamable HTTP)
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_specs` | List all Cypress spec files. Optional `pattern` glob (default: `**/*.cy.{ts,js,tsx,jsx}`) |
| `read_spec` | Read a spec file's content by relative path |
| `get_config` | Read the Cypress config file (`cypress.config.ts/js/mjs/cjs`), secret-looking values redacted |
| `get_last_run` | Get results of the last test run: states, errors, command log, DOM snapshots |
| `get_screenshot` | Get a screenshot from the last run. Returns the image itself (up to 2 MB) plus path and size metadata |
| `query_dom` | Query the DOM snapshot of a failed test using a CSS selector |
| `run_spec` | Run a single Cypress spec file and wait for completion. Returns exit code and summary |

## Output format of `.cypress-mcp/last-run.json`

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
