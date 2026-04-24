import { parseArgs } from 'node:util';
import { secondsToFrames } from '@freecut/core';
import { toSnapshot } from '../sdk.mjs';
import { readSnapshot, writeSnapshot } from '../io.mjs';
import { rehydrate } from '../rehydrate.mjs';

const baseOptions = {
  type: { type: 'string' },
  track: { type: 'string' },
  from: { type: 'string' },
  duration: { type: 'string' },
  'media-id': { type: 'string' },
  label: { type: 'string' },
  src: { type: 'string' },
  // text
  text: { type: 'string' },
  'font-size': { type: 'string' },
  'font-family': { type: 'string' },
  color: { type: 'string' },
  // shape
  shape: { type: 'string' },
  'fill-color': { type: 'string' },
  // image/video
  'source-width': { type: 'string' },
  'source-height': { type: 'string' },
  // audio
  volume: { type: 'string' },
  json: { type: 'boolean', default: false },
};

export async function runClipAdd(argv, { stdout }) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: baseOptions,
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut clip add <file> --type <kind> --track <id> --from <sec> --duration <sec> ...');

  requireOpt(values, 'type');
  requireOpt(values, 'track');
  requireOpt(values, 'from');
  requireOpt(values, 'duration');

  const snap = await readSnapshot(file);
  const builder = rehydrate(snap);
  const fps = builder.project.metadata.fps;
  const from = secondsToFrames(Number(values.from), fps);
  const duration = secondsToFrames(Number(values.duration), fps);

  const common = {
    trackId: values.track,
    from,
    durationInFrames: duration,
    ...(values.label !== undefined && { label: values.label }),
    ...(values['media-id'] !== undefined && { mediaId: values['media-id'] }),
  };

  let item;
  switch (values.type) {
    case 'video':
      item = builder.addVideoClip({
        ...common,
        ...(values.src !== undefined && { src: values.src }),
        ...(values['source-width'] !== undefined && { sourceWidth: Number(values['source-width']) }),
        ...(values['source-height'] !== undefined && { sourceHeight: Number(values['source-height']) }),
        ...(values.volume !== undefined && { volume: Number(values.volume) }),
      });
      break;
    case 'audio':
      item = builder.addAudioClip({
        ...common,
        ...(values.src !== undefined && { src: values.src }),
        ...(values.volume !== undefined && { volume: Number(values.volume) }),
      });
      break;
    case 'image':
      item = builder.addImageClip({
        ...common,
        ...(values.src !== undefined && { src: values.src }),
        ...(values['source-width'] !== undefined && { sourceWidth: Number(values['source-width']) }),
        ...(values['source-height'] !== undefined && { sourceHeight: Number(values['source-height']) }),
      });
      break;
    case 'text':
      requireOpt(values, 'text');
      item = builder.addTextClip({
        ...common,
        text: values.text,
        ...(values.color !== undefined && { color: values.color }),
        ...(values['font-size'] !== undefined && { fontSize: Number(values['font-size']) }),
        ...(values['font-family'] !== undefined && { fontFamily: values['font-family'] }),
      });
      break;
    case 'shape':
      requireOpt(values, 'shape');
      item = builder.addShapeClip({
        ...common,
        shapeType: values.shape,
        ...(values['fill-color'] !== undefined && { fillColor: values['fill-color'] }),
      });
      break;
    case 'adjustment':
      item = builder.addAdjustmentLayer(common);
      break;
    default:
      throw new Error(`unknown --type ${values.type}`);
  }

  builder.touch();
  await writeSnapshot(file, toSnapshot(builder));

  if (values.json) {
    stdout.write(`${JSON.stringify({ itemId: item.id, type: item.type })}\n`);
  } else {
    stdout.write(`added ${item.type} clip ${item.id}\n`);
  }
}

function requireOpt(values, key) {
  if (values[key] === undefined || values[key] === '') {
    throw new Error(`--${key} is required`);
  }
}
