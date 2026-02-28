#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const DEFAULT_ASSETS_DIR = path.join(ROOT_DIR, 'dist', 'assets');

const CHUNK_BUDGETS = [
  { chunk: 'react-vendor', prefix: 'react-vendor-', maxBytes: 250 * 1024, maxFiles: 1 },
  { chunk: 'feature-editing-core', prefix: 'feature-editing-core-', maxBytes: 500 * 1024, maxFiles: 1 },
  { chunk: 'feature-editing-ui', prefix: 'feature-editing-ui-', maxBytes: 240 * 1024, maxFiles: 1 },
  { chunk: 'feature-composition-runtime', prefix: 'feature-composition-runtime-', maxBytes: 220 * 1024, maxFiles: 1 },
  { chunk: 'media-bunny-core', prefix: 'media-bunny-core-', maxBytes: 560 * 1024, maxFiles: 1 },
  { chunk: 'media-ac3-decoder', prefix: 'media-ac3-decoder-', maxBytes: 1250 * 1024, maxFiles: 1 },
  { chunk: 'media-processing', prefix: 'media-processing-', maxBytes: 1250 * 1024, maxFiles: 1, required: false },
  { chunk: 'media-mp3-encoder', prefix: 'media-mp3-encoder-', maxBytes: 350 * 1024, maxFiles: 1 },
  { chunk: 'canvas-audio', prefix: 'canvas-audio-', maxBytes: 32 * 1024, maxFiles: 2, required: false },
  { chunk: 'export-render.worker', prefix: 'export-render.worker-', maxBytes: 450 * 1024, maxFiles: 1 },
  { chunk: 'mediabunny-ac3', prefix: 'mediabunny-ac3-', maxBytes: 1250 * 1024, maxFiles: 2 },
  { chunk: 'mediabunny-mp3-encoder', prefix: 'mediabunny-mp3-encoder-', maxBytes: 350 * 1024, maxFiles: 1 },
];

function parseArgs(argv) {
  let assetsDir = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist') {
      assetsDir = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return { assetsDir };
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function getAssetsDir(inputDir) {
  if (!inputDir) return DEFAULT_ASSETS_DIR;
  return path.resolve(ROOT_DIR, inputDir);
}

function readAssetFiles(assetsDir) {
  if (!fs.existsSync(assetsDir)) {
    throw new Error(`Assets directory not found: ${assetsDir}. Run "npm run build" first.`);
  }

  return fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolutePath = path.join(assetsDir, entry.name);
      const stat = fs.statSync(absolutePath);
      return {
        name: entry.name,
        size: stat.size,
      };
    })
    .filter((file) => file.name.endsWith('.js'));
}

function evaluateBudget(files, budget) {
  const matched = files.filter((file) => file.name.startsWith(budget.prefix));
  const required = budget.required ?? true;
  const count = matched.length;
  const largestBytes = matched.reduce((max, file) => Math.max(max, file.size), 0);

  const missingFail = required && count === 0;
  const fileCountFail = count > budget.maxFiles;
  const sizeFail = largestBytes > budget.maxBytes;
  const passed = !missingFail && !fileCountFail && !sizeFail;

  let failureReason = null;
  if (missingFail) {
    failureReason = 'missing expected chunk';
  } else if (fileCountFail) {
    failureReason = `found ${count} files (max ${budget.maxFiles})`;
  } else if (sizeFail) {
    failureReason = `largest file ${formatKb(largestBytes)} exceeds ${formatKb(budget.maxBytes)}`;
  }

  return {
    chunk: budget.chunk,
    count,
    maxFiles: budget.maxFiles,
    largestBytes,
    maxBytes: budget.maxBytes,
    passed,
    required,
    failureReason,
  };
}

function printResult(result) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const presence = result.count === 0 && !result.required ? 'optional/missing' : `${result.count}/${result.maxFiles} files`;
  const largest = formatKb(result.largestBytes);
  const limit = formatKb(result.maxBytes);
  const suffix = result.failureReason ? `, ${result.failureReason}` : '';
  console.log(`- [${status}] ${result.chunk}: largest ${largest}/${limit}, ${presence}${suffix}`);
}

function main() {
  const { assetsDir: maybeAssetsDir } = parseArgs(process.argv.slice(2));
  const assetsDir = getAssetsDir(maybeAssetsDir);
  const files = readAssetFiles(assetsDir);

  const results = CHUNK_BUDGETS.map((budget) => evaluateBudget(files, budget));
  const failed = results.filter((result) => !result.passed);

  if (failed.length > 0) {
    console.error(`Bundle budget check failed: ${failed.length} chunk budget(s) exceeded.\n`);
    for (const result of failed) {
      printResult(result);
    }
    console.error('\nAdjust chunk boundaries or update budgets intentionally with architectural review.');
    process.exit(1);
  }

  console.log(`Bundle budget check passed (${results.length} monitored chunk budgets):`);
  for (const result of results) {
    printResult(result);
  }
}

main();
