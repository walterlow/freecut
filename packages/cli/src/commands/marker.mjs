import { parseArgs } from 'node:util';
import { secondsToFrames, toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const options = {
  at: { type: 'string' },
  label: { type: 'string' },
  color: { type: 'string' },
  json: { type: 'boolean', default: false },
};

export async function runMarkerAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut marker add <file> --at <sec> [--label X --color #fff]');
  if (!values.at) throw new Error('--at is required');

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);
  const frame = secondsToFrames(Number(values.at), builder.project.metadata.fps);
  const m = builder.addMarker({
    frame,
    ...(values.label !== undefined && { label: values.label }),
    ...(values.color !== undefined && { color: values.color }),
  });
  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ markerId: m.id, frame })}\n`);
  } else {
    stdout.write(`added marker ${m.id} at frame ${frame}\n`);
  }
}
