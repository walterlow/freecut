/**
 * Chrome DevTools Protocol bridge to a running FreeCut tab.
 *
 * The user runs Chrome with `--remote-debugging-port=9222` (or an existing
 * dev instance does so). We pick the first tab matching our URL filter
 * and expose `callApi(method, args)` that forwards into `window.__FREECUT__`
 * via `Runtime.evaluate`.
 */

import CDP from 'chrome-remote-interface';

/** Default URL matcher — add paths you want to accept here. */
const DEFAULT_URL_MATCHERS = [
  /^https:\/\/freecut\.net(?::\d+)?(\/|$)/,
  /^https:\/\/[a-z0-9-]+\.freecut\.net(?::\d+)?(\/|$)/,
  /^http:\/\/localhost(?::\d+)?(\/|$)/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?(\/|$)/,
];

export class BridgeError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'BridgeError';
    if (cause) this.cause = cause;
  }
}

/**
 * Pick a candidate tab from CDP's target list. Prefers URL matches, then
 * falls back to any page target if the caller passed `--any-tab`.
 */
export function selectTab(targets, { url, anyTab = false } = {}) {
  const pages = targets.filter((t) => t.type === 'page');
  if (pages.length === 0) {
    throw new BridgeError('no page targets available (Chrome has no tabs open)');
  }

  if (url) {
    // Literal match or substring.
    const match = pages.find((t) => t.url === url || t.url.includes(url));
    if (!match) {
      throw new BridgeError(
        `no tab matched url=${JSON.stringify(url)}. Open tabs:\n` +
          pages.map((t) => `  - ${t.url}`).join('\n'),
      );
    }
    return match;
  }

  const matched = pages.find((t) => DEFAULT_URL_MATCHERS.some((rx) => rx.test(t.url)));
  if (matched) return matched;

  if (anyTab) return pages[0];

  throw new BridgeError(
    'no FreeCut tab found. Open freecut.net (or pass --url / --any-tab). Open tabs:\n' +
      pages.map((t) => `  - ${t.url}`).join('\n'),
  );
}

export async function connectBridge({ host, port = 9222, url, anyTab = false } = {}) {
  // Chrome on Windows binds IPv6 (::1) only by default, while chrome-
  // remote-interface's default host is 127.0.0.1. If the caller didn't
  // pick a host, try IPv4 first, then fall back to ::1 on connection
  // refused — covers every common OS/Chrome combo.
  const hostCandidates = host ? [host] : ['127.0.0.1', '::1'];

  let targets;
  let lastErr;
  let resolvedHost;
  for (const candidate of hostCandidates) {
    try {
      targets = await CDP.List({ host: candidate, port });
      resolvedHost = candidate;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!targets) {
    const hostLabel = hostCandidates.length > 1 ? `${hostCandidates.join(' / ')}:${port}` : `${hostCandidates[0]}:${port}`;
    throw new BridgeError(
      `could not reach Chrome DevTools at ${hostLabel}. ` +
        `Start Chrome with --remote-debugging-port=${port} (and optionally --user-data-dir) ` +
        `then open FreeCut.`,
      { cause: lastErr },
    );
  }
  host = resolvedHost;

  const target = selectTab(targets, { url, anyTab });
  let client;
  try {
    client = await CDP({ host, port, target });
  } catch (err) {
    throw new BridgeError(`failed to attach to tab ${target.id}`, { cause: err });
  }

  try {
    await client.Runtime.enable();
    await client.Page.enable();
  } catch (err) {
    await client.close().catch(() => {});
    throw new BridgeError('failed to enable Runtime/Page domains on tab', { cause: err });
  }

  async function waitForApi({ timeoutMs = 5000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const present = await evaluate(client, 'typeof window.__FREECUT__ === "object" && typeof window.__FREECUT__.ready === "function"');
      if (present) return true;
      await sleep(100);
    }
    throw new BridgeError(
      'window.__FREECUT__ is not installed on the target tab. ' +
        'In production, opt in with ?agent=1 or localStorage.setItem("freecut.agent","1") and reload.',
    );
  }

  /**
   * Call a method on window.__FREECUT__. Serializes args via JSON and
   * returns the parsed result. Errors thrown in the page bubble up with
   * their original message.
   */
  async function callApi(method, args = []) {
    if (typeof method !== 'string' || !method) {
      throw new BridgeError(`callApi: method must be a non-empty string, got ${method}`);
    }
    const payload = JSON.stringify(args);
    const expression = `(async () => {
      const api = window.__FREECUT__;
      if (!api) throw new Error('window.__FREECUT__ is not installed');
      const fn = api[${JSON.stringify(method)}];
      if (typeof fn !== 'function') throw new Error('__FREECUT__.' + ${JSON.stringify(method)} + ' is not a function');
      const args = ${payload};
      const result = await fn.apply(api, args);
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    })()`;
    const { result, exceptionDetails } = await client.Runtime.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      const msg = exceptionDetails.exception?.description
        ?? exceptionDetails.text
        ?? 'unknown page-side error';
      throw new BridgeError(`__FREECUT__.${method} threw: ${msg}`);
    }
    return result?.value ?? null;
  }

  async function close() {
    await client.close().catch(() => {});
  }

  return { target, callApi, waitForApi, close };
}

async function evaluate(client, expression) {
  const { result, exceptionDetails } = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
  });
  if (exceptionDetails) return false;
  return result?.value ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
