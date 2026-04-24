import { parseArgs } from 'node:util';
import { secondsToFrames } from '@freecut/core';
import { toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const options = {
  left: { type: 'string' },
  right: { type: 'string' },
  duration: { type: 'string' },
  preset: { type: 'string' },
  alignment: { type: 'string' },
  json: { type: 'boolean', default: false },
};

export async function runTransitionAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut transition add <file> --left <id> --right <id> --duration <sec> [--preset fade]');
  if (!values.left) throw new Error('--left is required');
  if (!values.right) throw new Error('--right is required');
  if (!values.duration) throw new Error('--duration is required');

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);
  const fps = builder.project.metadata.fps;
  const t = builder.addTransition({
    leftClipId: values.left,
    rightClipId: values.right,
    durationInFrames: secondsToFrames(Number(values.duration), fps),
    ...(values.preset !== undefined && { presetId: values.preset }),
    ...(values.alignment !== undefined && { alignment: Number(values.alignment) }),
  });
  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ transitionId: t.id })}\n`);
  } else {
    stdout.write(`added transition ${t.id}\n`);
  }
}
