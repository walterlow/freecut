/**
 * MCP stdio server wrapping `window.__FREECUT__`.
 */

import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectBridge } from './bridge.mjs';
import { buildTools } from './tools.mjs';

/**
 * Wrap `connectBridge` in a proxy that establishes the connection on
 * demand. `callApi` triggers the connect on first use; repeated calls
 * reuse the live connection. If the page reloads between calls, the
 * old CDP session fails and we auto-reconnect.
 */
function createLazyBridge(connectOpts) {
  let pending = null;
  let active = null;

  async function ensure() {
    if (active) return active;
    if (pending) return pending;
    pending = (async () => {
      const b = await connectBridge(connectOpts);
      await b.waitForApi();
      active = b;
      pending = null;
      return b;
    })().catch((err) => {
      pending = null;
      throw err;
    });
    return pending;
  }

  return {
    async callApi(method, args) {
      try {
        const b = await ensure();
        return await b.callApi(method, args);
      } catch (err) {
        // If the tab went away, drop the stale bridge and let the next
        // call reconnect.
        if (active && /disconnected|websocket|no targets|no page/i.test(String(err?.message))) {
          await active.close().catch(() => {});
          active = null;
        }
        throw err;
      }
    },
    async close() {
      const b = active;
      active = null;
      pending = null;
      if (b) await b.close().catch(() => {});
    },
  };
}

const HELP = `freecut-mcp — MCP bridge to a running FreeCut tab

Prereq: open Chrome with --remote-debugging-port=<port>, then visit FreeCut.
        In production, enable the agent API on the tab:
          ?agent=1   OR   localStorage.setItem('freecut.agent','1'); location.reload();

usage:
  freecut-mcp [--host 127.0.0.1] [--port 9222] [--url <matcher>] [--any-tab]

options:
  --host      CDP host (default 127.0.0.1)
  --port      CDP port (default 9222)
  --url       literal URL or substring to pick a specific tab
  --any-tab   fall back to the first page target if no URL match
  --help      show this help
`;

export async function runServer(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' }, // no default — bridge tries IPv4 then IPv6
      port: { type: 'string', default: '9222' },
      url: { type: 'string' },
      'any-tab': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const port = Number.parseInt(values.port, 10);
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) {
    throw new Error(`--port must be a valid TCP port, got ${values.port}`);
  }

  // Lazy-connect: we expose a bridge proxy that establishes the real
  // CDP connection on first use. This means the MCP server stays alive
  // even when Chrome isn't up yet — so Claude Desktop etc. don't loop
  // trying to restart a failing startup. Users get a clear error on the
  // first tool call, which is easier to see and fix.
  const bridgeHolder = createLazyBridge({
    host: values.host,
    port,
    url: values.url,
    anyTab: values['any-tab'],
  });

  const server = new McpServer({
    name: '@freecut/mcp',
    version: '0.0.1',
  });

  for (const tool of buildTools(bridgeHolder)) {
    server.registerTool(tool.name, tool.config, tool.handler);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // ignore
    }
    await bridgeHolder.close();
  };

  process.on('SIGINT', () => {
    shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    shutdown().finally(() => process.exit(0));
  });
}
