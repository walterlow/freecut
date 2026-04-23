import { parseArgs } from 'node:util';
import { createProject, toSnapshot } from '../sdk.mjs';
import { writeSnapshot } from '../io.mjs';

const options = {
  name: { type: 'string' },
  fps: { type: 'string', default: '30' },
  width: { type: 'string', default: '1920' },
  height: { type: 'string', default: '1080' },
  background: { type: 'string' },
  description: { type: 'string', default: '' },
  json: { type: 'boolean', default: false },
};

export async function runNew(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut new <file> [options]');

  const builder = createProject({
    name: values.name ?? basename(file),
    description: values.description,
    fps: intOpt(values.fps, 'fps'),
    width: intOpt(values.width, 'width'),
    height: intOpt(values.height, 'height'),
    ...(values.background !== undefined && { backgroundColor: values.background }),
  });
  builder.touch();

  const snapshot = toSnapshot(builder);
  await writeSnapshot(file, snapshot);

  if (values.json) {
    stdout.write(`${JSON.stringify({ projectId: builder.project.id, file })}\n`);
  } else {
    stdout.write(`created ${file} (${builder.project.id})\n`);
  }
}

function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  const last = parts[parts.length - 1] ?? 'project';
  return last.replace(/\.[^.]+$/, '') || 'project';
}

function intOpt(raw, label) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`--${label} must be a positive integer, got ${raw}`);
  }
  return n;
}
