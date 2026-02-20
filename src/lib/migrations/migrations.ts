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
import { DEFAULT_TRACK_HEIGHT } from '@/features/timeline/constants';

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
          return { ...track, height: DEFAULT_TRACK_HEIGHT };
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
          return { ...track, height: 80 };
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
