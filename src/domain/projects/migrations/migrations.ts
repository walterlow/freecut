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

  /**
   * Version 6: Migrate legacy effects to GPU shader effects
   *
   * Converts CSS filter, glitch, canvas-effect (halftone), overlay-effect (vignette),
   * and color-grading effects to their GPU equivalents. LUT effects are dropped
   * (no GPU equivalent for custom .cube files).
   */
  6: {
    version: 6,
    description:
      'Migrate legacy effects (CSS filters, glitch, halftone, vignette, color grading) to GPU shader effects',
    migrate: (project: Project): Project => {
      if (!project.timeline?.items) {
        return project;
      }

      const updatedItems = project.timeline.items.map((item) => {
        const effects = (item as Record<string, unknown>).effects as
          | Array<{ id: string; effect: Record<string, unknown>; enabled: boolean }>
          | undefined;

        if (!effects || effects.length === 0) {
          return item;
        }

        const convertedEffects: Array<{ id: string; effect: Record<string, unknown>; enabled: boolean }> = [];

        for (const entry of effects) {
          const effect = entry.effect;
          const type = effect.type as string;

          // Pass through existing gpu-effect entries unchanged
          if (type === 'gpu-effect') {
            convertedEffects.push(entry);
            continue;
          }

          if (type === 'css-filter') {
            const filter = effect.filter as string;
            const value = effect.value as number;
            let gpuEffect: Record<string, unknown> | null = null;

            switch (filter) {
              case 'brightness':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-brightness',
                  params: { amount: (value - 100) / 100 },
                };
                break;
              case 'contrast':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-contrast',
                  params: { amount: value / 100 },
                };
                break;
              case 'saturate':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-saturation',
                  params: { amount: value / 100 },
                };
                break;
              case 'blur':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-gaussian-blur',
                  params: { radius: value, samples: 5 },
                };
                break;
              case 'hue-rotate':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-hue-shift',
                  params: { shift: value / 360 },
                };
                break;
              case 'grayscale':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-grayscale',
                  params: { amount: value / 100 },
                };
                break;
              case 'sepia':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-sepia',
                  params: { amount: value / 100 },
                };
                break;
              case 'invert':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-invert',
                  params: {},
                };
                break;
              default:
                // Unknown css-filter variant — pass through as-is
                convertedEffects.push(entry);
                continue;
            }

            convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
            continue;
          }

          if (type === 'glitch') {
            const variant = effect.variant as string;
            const intensity = effect.intensity as number;
            let gpuEffect: Record<string, unknown> | null = null;

            switch (variant) {
              case 'rgb-split':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-rgb-split',
                  params: { amount: intensity * 0.05, angle: 0 },
                };
                break;
              case 'scanlines':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-scanlines',
                  params: { density: 5, opacity: intensity },
                };
                break;
              case 'color-glitch':
                gpuEffect = {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-color-glitch',
                  params: { intensity, speed: 1 },
                };
                break;
              default:
                convertedEffects.push(entry);
                continue;
            }

            convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
            continue;
          }

          if (type === 'canvas-effect' && effect.variant === 'halftone') {
            const gpuEffect = {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-halftone',
              params: {
                patternType: effect.patternType,
                dotSize: effect.dotSize,
                spacing: effect.spacing,
                angle: effect.angle,
                intensity: effect.intensity,
                invert: effect.inverted ?? false,
              },
            };
            convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
            continue;
          }

          if (type === 'overlay-effect' && effect.variant === 'vignette') {
            const gpuEffect = {
              type: 'gpu-effect',
              gpuEffectType: 'gpu-vignette',
              params: {
                amount: effect.intensity,
                size: effect.size ?? 0.5,
                softness: effect.softness ?? 0.5,
                roundness: 1,
              },
            };
            convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
            continue;
          }

          if (type === 'color-grading') {
            const variant = effect.variant as string;

            if (variant === 'lut') {
              // Drop LUT effects — no GPU equivalent for custom .cube files
              continue;
            }

            if (variant === 'curves') {
              const gpuEffect = {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-curves',
                params: {
                  shadows: effect.shadows,
                  midtones: effect.midtones,
                  highlights: effect.highlights,
                  contrast: effect.contrast,
                  red: effect.red,
                  green: effect.green,
                  blue: effect.blue,
                },
              };
              convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
              continue;
            }

            if (variant === 'wheels') {
              const gpuEffect = {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-color-wheels',
                params: {
                  shadowsHue: effect.shadowsHue,
                  shadowsAmount: effect.shadowsAmount,
                  midtonesHue: effect.midtonesHue,
                  midtonesAmount: effect.midtonesAmount,
                  highlightsHue: effect.highlightsHue,
                  highlightsAmount: effect.highlightsAmount,
                  temperature: effect.temperature,
                  tint: effect.tint,
                  saturation: effect.saturation,
                },
              };
              convertedEffects.push({ id: entry.id, effect: gpuEffect, enabled: entry.enabled });
              continue;
            }
          }

          // Unknown effect type — pass through as-is
          convertedEffects.push(entry);
        }

        return {
          ...item,
          effects: convertedEffects,
        };
      });

      return {
        ...project,
        timeline: {
          ...project.timeline,
          items: updatedItems,
        },
      };
    },
  },

  /**
   * Version 7: Add blend mode, masks, and corner pin fields
   *
   * New optional fields on timeline items:
   * - blendMode: layer compositing blend mode (default: 'normal')
   * - masks: bezier mask paths array (default: [])
   * - cornerPin: perspective warp corners (default: undefined)
   *
   * These fields are all optional with sensible defaults so no data
   * transformation is needed — this migration just bumps the version.
   */
  7: {
    version: 7,
    description: 'Add blend mode, masks, and corner pin fields to timeline items',
    migrate: (project: Project): Project => project,
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
