import { parseArgs } from 'node:util';
import { lintSnapshot } from '@freecut/core';
import { readSnapshot } from '../io.mjs';

const options = {
  json: { type: 'boolean', default: false },
  strict: { type: 'boolean', default: false },
};

export async function runLint(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut lint <file> [--json] [--strict]');

  const snap = await readSnapshot(file);
  const result = lintSnapshot(snap);

  if (values.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    writeHumanResult(stdout, result);
  }

  if (result.errorCount > 0) {
    throw new Error(`lint failed: ${result.errorCount} error(s), ${result.warningCount} warning(s)`);
  }
  if (values.strict && result.warningCount > 0) {
    throw new Error(`lint failed in strict mode: ${result.warningCount} warning(s)`);
  }
}

function writeHumanResult(stdout, result) {
  if (result.findings.length === 0) {
    stdout.write('lint passed: no issues found\n');
    return;
  }

  stdout.write(`lint ${result.ok ? 'passed with warnings' : 'failed'}: `);
  stdout.write(`${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info\n`);
  for (const finding of result.findings) {
    const location = finding.path ? ` ${finding.path}` : '';
    stdout.write(`  [${finding.severity}] ${finding.code}${location}: ${finding.message}\n`);
  }
}
