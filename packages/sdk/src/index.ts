/**
 * @freecut/sdk — programmatic authoring of FreeCut projects.
 *
 * Build `.fcproject`-shaped snapshots in Node, Bun, browsers, or agent
 * sandboxes. The FreeCut editor opens the output via its existing JSON
 * import service.
 *
 * Typical shape:
 *
 *   import { createProject, serialize } from '@freecut/sdk';
 *
 *   const p = createProject({ name: 'demo', fps: 30 });
 *   const track = p.addTrack({ kind: 'video' });
 *   p.addVideoClip({
 *     trackId: track.id,
 *     from: 0,
 *     durationInFrames: p.secondsToFrames(5),
 *     mediaId: 'media-1',
 *   });
 *   p.touch();
 *   writeFileSync('demo.fcproject', serialize(p));
 */

export * from './types.js';
export { createProject, ProjectBuilder } from './builder.js';
export type { CreateProjectOptions } from './builder.js';
export { serialize, parse, toSnapshot, SnapshotParseError } from './serialize.js';
export type { SerializeOptions } from './serialize.js';
export { validateSnapshot, lintSnapshot } from './validate.js';
export type {
  ValidateSnapshotOptions,
  ValidationFinding,
  ValidationResult,
  ValidationSeverity,
} from './validate.js';
export { secondsToFrames, framesToSeconds } from './time.js';
export { randomIds, deterministicIds } from './ids.js';
export type { IdGenerator } from './ids.js';
