import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_RUNS = 20;

function parseRuns(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--runs') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }
    if (arg.startsWith('--runs=')) {
      const value = Number(arg.slice('--runs='.length));
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }
  }
  return DEFAULT_RUNS;
}

const runs = parseRuns(process.argv.slice(2));
const testCommand = `npm run -s test:preview-sync -- --reporter=dot`;

let failures = 0;

for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
  const startedAt = Date.now();
  process.stdout.write(`[preview-sync-stress] run ${runIndex}/${runs}... `);

  const result = spawnSync(testCommand, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: true,
  });

  const durationMs = Date.now() - startedAt;
  if (!result.error && result.status === 0) {
    process.stdout.write(`ok (${durationMs}ms)\n`);
    continue;
  }

  failures += 1;
  process.stdout.write(`failed (${durationMs}ms)\n`);
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  break;
}

if (failures > 0) {
  process.exit(1);
}

console.log(`[preview-sync-stress] passed ${runs}/${runs} runs`);
