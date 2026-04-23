import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lintSnapshot, validateSnapshot } from '../sdk.mjs';
import { readSnapshot } from '../io.mjs';

const options = {
  json: { type: 'boolean', default: false },
};

export async function runDoctor(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  const checks = [];

  checks.push(checkNode());
  checks.push(checkSdkExports());
  checks.push(checkSdkDist());
  checks.push(checkProjectWorkspace());

  if (file) {
    checks.push(await checkSnapshot(file));
  }

  const summary = summarize(checks);
  if (values.json) {
    stdout.write(`${JSON.stringify({ ok: summary.fail === 0, ...summary, checks }, null, 2)}\n`);
    return;
  }

  stdout.write(`freecut doctor: ${summary.pass} passed, ${summary.warn} warning(s), ${summary.fail} failed\n`);
  for (const check of checks) {
    stdout.write(`  [${check.status}] ${check.name}: ${check.message}\n`);
  }
}

function checkNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major >= 18) {
    return pass('node', `Node ${process.versions.node}`);
  }
  return fail('node', `Node ${process.versions.node}; @freecut/cli requires >=18`);
}

function checkSdkExports() {
  if (typeof validateSnapshot === 'function' && typeof lintSnapshot === 'function') {
    return pass('sdk exports', 'validateSnapshot and lintSnapshot are available');
  }
  return fail('sdk exports', 'validation exports are missing from @freecut/sdk');
}

function checkSdkDist() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sdkDist = resolve(here, '..', '..', '..', 'sdk', 'dist', 'index.js');
  if (existsSync(sdkDist)) return pass('sdk dist', `found ${sdkDist}`);
  return warn('sdk dist', 'packages/sdk/dist is missing; run npm run build in packages/sdk before using the CLI from source');
}

function checkProjectWorkspace() {
  const rootPackage = resolve(process.cwd(), 'package.json');
  if (!existsSync(rootPackage)) {
    return warn('project workspace', 'no package.json found in current directory');
  }
  return pass('project workspace', `found ${rootPackage}`);
}

async function checkSnapshot(file) {
  try {
    const snapshot = await readSnapshot(file);
    const result = validateSnapshot(snapshot);
    if (result.errorCount > 0) {
      return fail('snapshot', `${file}: ${result.errorCount} error(s), ${result.warningCount} warning(s)`);
    }
    if (result.warningCount > 0) {
      return warn('snapshot', `${file}: ${result.warningCount} warning(s)`);
    }
    return pass('snapshot', `${file}: valid`);
  } catch (err) {
    return fail('snapshot', `${file}: ${err?.message ?? err}`);
  }
}

function summarize(checks) {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
}

function pass(name, message) {
  return { name, status: 'pass', message };
}

function warn(name, message) {
  return { name, status: 'warn', message };
}

function fail(name, message) {
  return { name, status: 'fail', message };
}
