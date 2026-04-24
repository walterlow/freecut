import CDP from 'chrome-remote-interface';

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

export async function connectBridge({ host, port = 9222, url, anyTab = false } = {}) {
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
    throw new BridgeError(
      `could not reach Chrome DevTools at ${hostCandidates.join(' / ')}:${port}. ` +
      `Start Chrome with --remote-debugging-port=${port}, open FreeCut, and enable ?agent=1 in production.`,
      { cause: lastErr },
    );
  }

  const target = selectTab(targets, { url, anyTab });
  const client = await CDP({ host: resolvedHost, port, target });
  await client.Runtime.enable();
  await client.Page.enable();

  async function waitForApi({ timeoutMs = 5000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const present = await evaluate(
        client,
        'typeof window.__FREECUT__ === "object" && typeof window.__FREECUT__.ready === "function"',
      );
      if (present) return true;
      await sleep(100);
    }
    throw new BridgeError(
      'window.__FREECUT__ is not installed on the target tab. ' +
      'In production, opt in with ?agent=1 or localStorage.setItem("freecut.agent","1") and reload.',
    );
  }

  async function callApi(method, args = []) {
    const expression = `(async () => {
      const api = window.__FREECUT__;
      if (!api) throw new Error('window.__FREECUT__ is not installed');
      const fn = api[${JSON.stringify(method)}];
      if (typeof fn !== 'function') throw new Error('__FREECUT__.' + ${JSON.stringify(method)} + ' is not a function');
      const result = await fn.apply(api, ${JSON.stringify(args)});
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

  return {
    target,
    waitForApi,
    callApi,
    close: () => client.close().catch(() => {}),
  };
}

function selectTab(targets, { url, anyTab = false } = {}) {
  const pages = targets.filter((t) => t.type === 'page');
  if (url) {
    const match = pages.find((t) => t.url === url || t.url.includes(url));
    if (match) return match;
  } else {
    const matched = pages.find((t) => DEFAULT_URL_MATCHERS.some((rx) => rx.test(t.url)));
    if (matched) return matched;
  }
  if (anyTab && pages[0]) return pages[0];
  throw new BridgeError(
    'no FreeCut tab found. Open freecut.net or localhost, or pass --url / --any-tab. Open tabs:\n' +
    pages.map((t) => `  - ${t.url}`).join('\n'),
  );
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
