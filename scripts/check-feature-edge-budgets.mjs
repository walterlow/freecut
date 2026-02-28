#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const REPORT_SCRIPT = path.join(ROOT_DIR, 'scripts', 'report-feature-edges.mjs');

const EDGE_BUDGETS = [
  { edge: 'editor -> timeline', maxImports: 2, maxFiles: 2 },
  { edge: 'editor -> preview', maxImports: 8, maxFiles: 2 },
  { edge: 'editor -> media-library', maxImports: 8, maxFiles: 2 },
  { edge: 'preview -> timeline', maxImports: 2, maxFiles: 2 },
  { edge: 'preview -> player', maxImports: 2, maxFiles: 2 },
  { edge: 'timeline -> media-library', maxImports: 2, maxFiles: 2 },
  { edge: 'media-library -> timeline', maxImports: 2, maxFiles: 2 },
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
