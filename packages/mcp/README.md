# @freecut/mcp

Model Context Protocol server that bridges AI agents (Claude Desktop,
Cursor, Zed, Raycast, etc.) into a running FreeCut tab. Agents drive the
live editor by calling MCP tools, which the server forwards into the tab
via Chrome DevTools Protocol → `window.__FREECUT__`.

```
┌─────────────────┐    stdio MCP      ┌────────────────┐    CDP     ┌──────────────┐
│  Claude Desktop │ ─────────────────▶│ freecut-mcp    │ ──────────▶│ Chrome tab   │
│  / Cursor / …   │                   │ (this package) │            │ __FREECUT__  │
└─────────────────┘                   └────────────────┘            └──────────────┘
```

## Prereqs

1. Chrome/Chromium running with remote debugging:
   ```bash
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 --user-data-dir=/tmp/freecut-agent

   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
     --remote-debugging-port=9222 --user-data-dir=%TEMP%\freecut-agent

   # Linux
   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/freecut-agent
   ```
2. Open FreeCut in that Chrome instance (dev: `http://localhost:5173`,
   prod: `https://freecut.net`).
3. In production, opt the tab into the agent API once per workspace:
   ```js
   localStorage.setItem('freecut.agent', '1');
   location.reload();
   // or append ?agent=1 to the URL
   ```

## Install & run

```bash
cd packages/mcp
npm install
node bin/freecut-mcp.mjs --port 9222
```

## Configure an MCP client

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "freecut": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/bin/freecut-mcp.mjs", "--port", "9222"]
    }
  }
}
```

**Cursor / others** — point the MCP configuration at
`node packages/mcp/bin/freecut-mcp.mjs --port 9222`.

## Tools

| Tool | Purpose |
| --- | --- |
| `freecut_get_timeline` | Tracks, items, transitions, markers |
| `freecut_get_playback` | Current frame, isPlaying, zoom |
| `freecut_get_project` | Project id/name/resolution/fps |
| `freecut_get_selection` | Currently selected ids |
| `freecut_play` / `freecut_pause` / `freecut_seek` | Playback |
| `freecut_select_items` | Replace selection |
| `freecut_add_track` / `freecut_remove_track` | Tracks |
| `freecut_add_item` / `freecut_update_item` / `freecut_move_item` / `freecut_remove_item` / `freecut_set_transform` | Items |
| `freecut_add_effect` / `freecut_remove_effect` | GPU effects |
| `freecut_add_transition` / `freecut_remove_transition` | Transitions |
| `freecut_add_marker` | Markers |
| `freecut_load_snapshot` / `freecut_export_snapshot` | Round-trip SDK/CLI snapshots through the live editor |

All tools return both a `text` content block (pretty-printed JSON) and a
`structuredContent` payload for clients that consume structured output.

## Flags

| Flag | Default | Notes |
| --- | --- | --- |
| `--host` | `127.0.0.1` | CDP host |
| `--port` | `9222` | CDP port |
| `--url` | *(none)* | Literal URL or substring; picks a specific tab |
| `--any-tab` | `false` | Fall back to the first page target if no URL match |

## Troubleshooting

- **"could not reach Chrome DevTools"** — Chrome isn't running with
  `--remote-debugging-port`, or the port is wrong.
- **"window.__FREECUT__ is not installed"** — in prod you need
  `?agent=1` or `localStorage['freecut.agent']='1'`. In dev it's always on.
- **"no FreeCut tab found"** — the tab URL doesn't match the built-in
  list (`freecut.net`, `localhost`, `127.0.0.1`). Pass `--url <substring>`
  or `--any-tab`.

## Design notes

- Stdio transport. Each tool call is one `Runtime.evaluate` round-trip
  wrapped in `JSON.parse(JSON.stringify(...))` for safe serialization.
- Input schemas are zod raw-shape objects — the MCP SDK converts them to
  JSON Schema for clients automatically.
- No browser launch. By connecting to an already-open tab we keep the
  user's workspace folder handle, auth state, and File System Access
  permissions alive.
