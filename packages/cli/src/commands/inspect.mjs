import { parseArgs } from 'node:util';
import { readSnapshot } from '../io.mjs';

const options = {
  json: { type: 'boolean', default: false },
};

export async function runInspect(argv, { stdout }) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error('usage: freecut inspect <file> [--json]');

  const snap = await readSnapshot(file);
  const tl = snap.project.timeline ?? { tracks: [], items: [], transitions: [], markers: [] };

  if (values.json) {
    stdout.write(
      `${JSON.stringify(
        {
          project: {
            id: snap.project.id,
            name: snap.project.name,
            duration: snap.project.duration,
            resolution: snap.project.metadata,
          },
          tracks: tl.tracks?.map((t) => ({ id: t.id, name: t.name, kind: t.kind, order: t.order })) ?? [],
          items: tl.items?.map((it) => ({
            id: it.id,
            type: it.type,
            trackId: it.trackId,
            from: it.from,
            durationInFrames: it.durationInFrames,
            label: it.label,
          })) ?? [],
          transitions: tl.transitions ?? [],
          markers: tl.markers ?? [],
          mediaReferences: snap.mediaReferences.map((m) => ({ id: m.id, fileName: m.fileName })),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const { width, height, fps } = snap.project.metadata;
  stdout.write(`${snap.project.name} (${snap.project.id})\n`);
  stdout.write(`  ${width}x${height} @ ${fps}fps · ${snap.project.duration.toFixed(2)}s\n`);
  stdout.write(`  tracks: ${tl.tracks?.length ?? 0}  items: ${tl.items?.length ?? 0}  `);
  stdout.write(`transitions: ${tl.transitions?.length ?? 0}  media: ${snap.mediaReferences.length}\n`);
  for (const t of tl.tracks ?? []) {
    stdout.write(`  - track ${t.id} "${t.name}" (${t.kind ?? 'video'}) order=${t.order}\n`);
  }
  for (const it of tl.items ?? []) {
    const end = it.from + it.durationInFrames;
    stdout.write(`  - item ${it.id} type=${it.type} track=${it.trackId} frames=[${it.from}, ${end})\n`);
  }
}
