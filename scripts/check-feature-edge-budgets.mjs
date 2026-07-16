#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const REPORT_SCRIPT = path.join(ROOT_DIR, 'scripts', 'report-feature-edges.mjs');

const EDGE_BUDGETS = [
  // Re-baselined for the editor's intentionally split timeline adapter surface
  // plus project live-sync state restoration. Store, hooks, UI, panels, motion,
  // subscriptions, cache and test helpers all cross through dedicated deps/*
  // contracts; the file count remains capped so this does not spread further.
  { edge: 'editor -> timeline', maxImports: 78, maxFiles: 11 },
  // The editor preview contract added one supported preview export. Keep the
  // file budget tight so this remains consolidated behind the existing adapter.
  { edge: 'editor -> preview', maxImports: 16, maxFiles: 2 },
  { edge: 'editor -> media-library', maxImports: 13, maxFiles: 2 },
  { edge: 'preview -> timeline', maxImports: 2, maxFiles: 2 },
  { edge: 'preview -> player', maxImports: 2, maxFiles: 2 },
  // Raised for the on-device transcription + caption feature: the timeline
  // transcript editor / auto-captions and the media-library Parakeet/Whisper
  // pipeline now interoperate through more deps/ adapter contracts.
  { edge: 'timeline -> media-library', maxImports: 16, maxFiles: 7 },
  // Raised for the multi-timeline sequences + compositions feature: the media
  // library's compositions/sequences section reaches the sequences store,
  // composition-navigation store and cycle guard through deps/ adapters.
  { edge: 'media-library -> timeline', maxImports: 21, maxFiles: 5 },
  { edge: 'composition-runtime -> player', maxImports: 8, maxFiles: 2 },
];

function parseArgs(argv) {
  let inputPath = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      inputPath = argv[i + 1] ?? null;
      i += 1;
    }
  }

  return { inputPath };
}

function loadReportFromScript() {
  const output = execFileSync(process.execPath, [REPORT_SCRIPT, '--json'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function loadReportFromFile(inputPath) {
  const absolutePath = path.resolve(ROOT_DIR, inputPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function readReport(inputPath) {
  if (inputPath) return loadReportFromFile(inputPath);
  return loadReportFromScript();
}

function toEdgeMap(rows) {
  return new Map(
    rows.map((row) => [
      row.edge,
      {
        imports: row.imports,
        files: row.files,
      },
    ])
  );
}

function printBudgetRow(result) {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(
    `- [${status}] ${result.edge}: imports ${result.actualImports}/${result.maxImports}, files ${result.actualFiles}/${result.maxFiles}`
  );
}

function main() {
  const { inputPath } = parseArgs(process.argv.slice(2));
  const report = readReport(inputPath);

  const directRows = report.directCrossFeatureOutsideDeps ?? [];
  const adapterRows = report.adapterCrossFeatureEdges ?? [];
  const edgeMap = toEdgeMap(adapterRows);

  const results = EDGE_BUDGETS.map((budget) => {
    const actual = edgeMap.get(budget.edge) ?? { imports: 0, files: 0 };
    const passed =
      actual.imports <= budget.maxImports && actual.files <= budget.maxFiles;

    return {
      edge: budget.edge,
      maxImports: budget.maxImports,
      maxFiles: budget.maxFiles,
      actualImports: actual.imports,
      actualFiles: actual.files,
      passed,
    };
  });

  const failedBudgets = results.filter((result) => !result.passed);

  if (directRows.length > 0) {
    console.error(
      `Edge budget check failed: detected ${directRows.length} direct cross-feature imports outside deps/*.`
    );
    process.exit(1);
  }

  if (failedBudgets.length > 0) {
    console.error(
      `Edge budget check failed: ${failedBudgets.length} monitored seam(s) exceeded budget.\n`
    );
    for (const failed of failedBudgets) {
      printBudgetRow(failed);
    }
    console.error(
      '\nReduce cross-feature adapter coupling or update budgets intentionally with architectural review.'
    );
    process.exit(1);
  }

  console.log(
    `Edge budget check passed (${EDGE_BUDGETS.length} monitored seams):`
  );
  for (const result of results) {
    printBudgetRow(result);
  }
}

main();
