/**
 * Blur Transition Renderers
 *
 * Includes: blur-through
 */

import type { TransitionRegistry, TransitionRenderer } from '../registry';
import type { TransitionStyleCalculation } from '../engine';
import type { TransitionDefinition } from '@/types/transition';

const ALL_TIMINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier'] as const;

// ============================================================================
// Blur Through
// ============================================================================

const blurThroughRenderer: TransitionRenderer = {
  calculateStyles(progress, isOutgoing): TransitionStyleCalculation {
    const p = Math.max(0, Math.min(1, progress));
    const maxBlur = 20; // px

    if (isOutgoing) {
      // Outgoing: blur increases, opacity fades at midpoint
      const blur = p < 0.5 ? p * 2 * maxBlur : maxBlur;
      const opacity = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2);
      return {
        opacity,
        // Blur is applied via filter, which we encode in transform as a hint
        // The actual CSS filter would be applied separately
        transform: `blur(${blur}px)`,
      };
    }
    // Incoming: starts blurred, clears up
    const blur = p > 0.5 ? (1 - p) * 2 * maxBlur : maxBlur;
    const opacity = p > 0.5 ? 1 : p * 2;
    return {
      opacity,
      transform: `blur(${blur}px)`,
    };
  },
  renderCanvas(ctx, leftCanvas, rightCanvas, progress, _dir, _canvas) {
    const p = Math.max(0, Math.min(1, progress));
    const maxBlur = 20;

    // Canvas 2D blur fallback (uses filter if supported)
    if (p < 0.5) {
      const blur = p * 2 * maxBlur;
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(leftCanvas, 0, 0);
      ctx.restore();
    } else {
      const blur = (1 - p) * 2 * maxBlur;
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(rightCanvas, 0, 0);
      ctx.restore();
    }
  },
  glslShader: `
    uniform sampler2D from, to;
    uniform float progress;
    uniform vec2 resolution;
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution;
      float maxBlur = 0.03;
      float blur = progress < 0.5 ? progress * 2.0 * maxBlur : (1.0 - progress) * 2.0 * maxBlur;
      vec4 c1 = texture2D(from, uv);
      vec4 c2 = texture2D(to, uv);
      float t = smoothstep(0.4, 0.6, progress);
      gl_FragColor = mix(c1, c2, t);
    }
  `,
};

const blurThroughDef: TransitionDefinition = {
  id: 'blur-through',
  label: 'Blur Through',
  description: 'Blur out then in',
  category: 'blur',
  icon: 'Cloudy',
  hasDirection: false,
  supportedTimings: [...ALL_TIMINGS],
  defaultDuration: 30,
  minDuration: 10,
  maxDuration: 90,
  requiresWebGL: false, // Optional WebGL, has canvas fallback
};

// ============================================================================
// Registration
// ============================================================================

export function registerBlurTransitions(registry: TransitionRegistry): void {
  registry.register('blur-through', blurThroughDef, blurThroughRenderer);
}
