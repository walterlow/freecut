import { parseArgs } from 'node:util';
import { toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const options = {
  item: { type: 'string' },
  'gpu-type': { type: 'string' },
  params: { type: 'string', default: '{}' },
  disabled: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
};

export async function runEffectAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut effect add <file> --item <id> --gpu-type <name> [--params JSON]');
  if (!values.item) throw new Error('--item is required');
  if (!values['gpu-type']) throw new Error('--gpu-type is required (e.g. gaussian-blur)');

  let params;
  try {
    params = JSON.parse(values.params);
  } catch (err) {
    throw new Error(`--params must be valid JSON: ${err.message}`);
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('--params must be a JSON object');
  }

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);
  const effectId = builder.applyGpuEffect(
    values.item,
    { type: 'gpu-effect', gpuEffectType: values['gpu-type'], params },
    !values.disabled,
  );
  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ effectId })}\n`);
  } else {
    stdout.write(`added effect ${effectId} on ${values.item}\n`);
  }
}
