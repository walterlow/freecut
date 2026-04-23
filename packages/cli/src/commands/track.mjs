import { parseArgs } from 'node:util';
import { toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const addOptions = {
  kind: { type: 'string', default: 'video' },
  name: { type: 'string' },
  json: { type: 'boolean', default: false },
};

export async function runTrackAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options: addOptions, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut track add <file> [--kind video|audio] [--name X]');
  if (values.kind !== 'video' && values.kind !== 'audio') {
    throw new Error(`--kind must be 'video' or 'audio', got ${values.kind}`);
  }

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);
  const track = builder.addTrack({
    kind: values.kind,
    ...(values.name !== undefined && { name: values.name }),
  });
  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ trackId: track.id })}\n`);
  } else {
    stdout.write(`added track ${track.id} (${track.kind})\n`);
  }
}
