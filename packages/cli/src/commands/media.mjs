import { parseArgs } from 'node:util';
import { toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const options = {
  id: { type: 'string' },
  'file-name': { type: 'string' },
  'file-size': { type: 'string', default: '0' },
  'mime-type': { type: 'string' },
  duration: { type: 'string', default: '0' },
  width: { type: 'string', default: '0' },
  height: { type: 'string', default: '0' },
  fps: { type: 'string', default: '0' },
  codec: { type: 'string', default: '' },
  bitrate: { type: 'string', default: '0' },
  'content-hash': { type: 'string' },
  json: { type: 'boolean', default: false },
};

export async function runMediaAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut media add <file> --file-name <name> [--id X --duration S --width W --height H --mime-type M ...]');
  if (!values['file-name']) throw new Error('--file-name is required');

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);

  const mime = values['mime-type'] ?? guessMime(values['file-name']);
  const ref = builder.addMediaReference({
    ...(values.id !== undefined && { id: values.id }),
    fileName: values['file-name'],
    fileSize: Number(values['file-size']),
    mimeType: mime,
    duration: Number(values.duration),
    width: Number(values.width),
    height: Number(values.height),
    fps: Number(values.fps),
    codec: values.codec,
    bitrate: Number(values.bitrate),
    ...(values['content-hash'] !== undefined && { contentHash: values['content-hash'] }),
  });

  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ mediaId: ref.id })}\n`);
  } else {
    stdout.write(`registered media ${ref.id} (${ref.fileName})\n`);
  }
}

function guessMime(fileName) {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['mp4', 'm4v'].includes(ext)) return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp3') return 'audio/mpeg';
  if (['wav', 'wave'].includes(ext)) return 'audio/wav';
  if (ext === 'aac') return 'audio/aac';
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}
