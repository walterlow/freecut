/**
 * Migration Definitions
 *
 * Each migration transforms projects from version N to N+1.
 * Migrations are run in order when loading older projects.
 *
 * IMPORTANT: Never modify existing migrations. Always add new ones.
 */

import type { Migration } from './types';
import type { Project } from '@/types/project';

// Historical constants used by specific migrations.
// Keep these as literals so old migration behavior doesn't drift when
// current UI defaults change.
const TRACK_HEIGHT_V2_TARGET = 64;
const TRACK_HEIGHT_V4_TARGET = 80;

/**
 * Migration registry.
 * Key is the target version number.
 */
const migrations: Record<number, Migration> = {
  /**
   * Version 2: Fix track height inconsistency
   *
   * Bug: timeline-store-facade.ts had a local DEFAULT_TRACK_HEIGHT = 80
   * that shadowed the constants.ts value of 64. This caused Track 1 to
   * be created with 80px height instead of 64px.
   *
   * Fix: Reset tracks with height 80 to the correct DEFAULT_TRACK_HEIGHT (64).
   */
  2: {
    version: 2,
    description: 'Fix track height from 80px to 64px (constants consistency)',
    migrate: (project: Project): Project => {
      if (!project.timeline?.tracks) {
        return project;
      }

      const updatedTracks = project.timeline.tracks.map((track) => {
        // Only fix tracks that have the buggy 80px height
        if (track.height === 80) {
          return { ...track, height: TRACK_HEIGHT_V2_TARGET };
        }
        return track;
      });

      return {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: updatedTracks,
        },
      };
    },
  },

  /**
   * Version 3: Transition system overhaul
   *
   * Adds default `alignment: 0.5` to all existing transitions for the new
   * asymmetric timing feature. Existing presentation/timing/direction values
   * remain valid as registry keys — no data loss.
   */
  3: {
    version: 3,
    description: 'Add alignment default (0.5) to transitions for asymmetric timing',
    migrate: (project: Project): Project => {
      if (!project.timeline?.transitions) {
        return project;
      }

      const updatedTransitions = project.timeline.transitions.map((t) => ({
        ...t,
        alignment: t.alignment ?? 0.5,
      }));

      return {
        ...project,
        timeline: {
          ...project.timeline,
          transitions: updatedTransitions,
        },
      };
    },
  },
  /**
   * Version 4: Increase default track height for 3-row clip layout
   *
   * The clip layout changed from 2-row (filmstrip with overlaid label + waveform)
   * to 3-row (label | filmstrip | waveform). Increase track height from 64 to 80
   * to accommodate the dedicated label row.
   */
  4: {
    version: 4,
    description: 'Increase track height from 64px to 80px for 3-row clip layout',
    migrate: (project: Project): Project => {
      if (!project.timeline?.tracks) {
        return project;
      }

      const updatedTracks = project.timeline.tracks.map((track) => {
        if (track.height === 64) {
          return { ...track, height: TRACK_HEIGHT_V4_TARGET };
        }
        return track;
      });

      return {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: updatedTracks,
        },
      };
    },
  },

  /**
   * Version 5: FCP-style overlap transition model
   *
   * Converts adjacent clips with transitions to overlapping clips.
   * For each transition:
   * - Right clip slides left by transition.durationInFrames
   * - Right clip's sourceStart adjusted back by equivalent source frames
   * - All subsequent items on the same track ripple left
   * - If right clip doesn't have enough handle, clamp transition duration
   */
  5: {
    version: 5,
    description: 'Convert transitions from virtual-window model to FCP-style overlap model',
    migrate: (project: Project): Project => {
      if (!project.timeline?.transitions || project.timeline.transitions.length === 0) {
        return project;
      }

      const items = [...(project.timeline.items ?? [])];
      const transitions = [...project.timeline.transitions];
      const itemsById = new Map(items.map((item) => [item.id, item]));

      // Process each transition: convert adjacent clips to overlapping
      const updatedTransitions = [];

      for (const transition of transitions) {
        const leftClip = itemsById.get(transition.leftClipId);
        const rightClip = itemsById.get(transition.rightClipId);
        if (!leftClip || !rightClip) {
          updatedTransitions.push(transition);
          continue;
        }

        // Check if clips are adjacent (old model) — if already overlapping, skip
        const leftEnd = leftClip.from + leftClip.durationInFrames;
        const isAdjacent = Math.abs(leftEnd - rightClip.from) <= 1;
        if (!isAdjacent) {
          // Already overlapping or separated — keep as is
          updatedTransitions.push(transition);
          continue;
        }

        // Clamp transition duration to clip durations
        let duration = transition.durationInFrames;
        const maxByClip = Math.min(leftClip.durationInFrames, rightClip.durationInFrames) - 1;
        if (duration > maxByClip) {
          duration = Math.max(1, maxByClip);
        }

        if (duration < 1) {
          // Can't convert — remove transition
          continue;
        }

        // Slide right clip left (sourceStart stays unchanged — the first D
        // source frames become the transition-in region)
        rightClip.from -= duration;

        // Ripple all items after the right clip's original position on the same track
        const originalRightFrom = rightClip.from + duration; // original position before slide
        for (const item of items) {
          if (item.id === rightClip.id) continue;
          if (item.trackId !== rightClip.trackId) continue;
          if (item.from > originalRightFrom) {
            item.from -= duration;
          }
        }

        // Update transition duration if clamped
        updatedTransitions.push(
          duration !== transition.durationInFrames
            ? { ...transition, durationInFrames: duration }
            : transition
        );
      }

      return {
        ...project,
        timeline: {
          ...project.timeline,
          items,
          transitions: updatedTransitions,
        },
      };
    },
  },
};

/**
 * Get all migrations that need to be applied for a given version.
 * Returns migrations in order from lowest to highest version.
 */
export function getMigrationsToApply(fromVersion: number, toVersion: number): Migration[] {
  const result: Migration[] = [];

  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const migration = migrations[v];
    if (migration) {
      result.push(migration);
    }
  }

  return result;
}
