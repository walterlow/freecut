/**
 * Rebuild a `ProjectBuilder` from an on-disk snapshot so subsequent
 * CLI commands can mutate the project through the SDK.
 */

import { ProjectBuilder } from './sdk.mjs';

/**
 * Wraps an existing project object back into a ProjectBuilder. We
 * sidestep the builder's constructor (which creates a fresh project)
 * and mutate the instance's internals directly, since the builder is
 * essentially a thin facade over a mutable project.
 */
export function rehydrate(snapshot, opts = {}) {
  const builder = new ProjectBuilder({
    name: snapshot.project.name,
    fps: snapshot.project.metadata.fps,
    width: snapshot.project.metadata.width,
    height: snapshot.project.metadata.height,
    ...(opts.ids !== undefined && { ids: opts.ids }),
    ...(opts.now !== undefined && { now: opts.now }),
  });
  // Replace the empty skeleton the constructor just built with the
  // on-disk project and media refs.
  Object.assign(builder.project, snapshot.project);
  builder.mediaReferences.length = 0;
  builder.mediaReferences.push(...snapshot.mediaReferences);
  // Ensure timeline container arrays exist (older snapshots may omit them).
  const tl = (builder.project.timeline ??= { tracks: [], items: [] });
  tl.tracks ??= [];
  tl.items ??= [];
  tl.transitions ??= [];
  tl.markers ??= [];
  return builder;
}
