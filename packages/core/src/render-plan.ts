import {
  collectProjectMediaUsage,
  planRenderMediaSources,
  type MediaUsage,
  type RenderMediaSourcePlan,
  type RenderMediaSourcesInput,
} from './media-plan.js';
import {
  resolveRangeFrames,
  validateRangeFrames,
  type FrameRange,
  type RenderRangeInput,
} from './range.js';

export interface ProjectRenderPlanOptions {
  range?: RenderRangeInput | null;
  renderWholeProject?: boolean;
  mediaSources?: RenderMediaSourcesInput;
}

export interface ProjectRenderPlan {
  effectiveRange: FrameRange | null;
  mediaUsage: Map<string, MediaUsage>;
  mediaSourcePlan: RenderMediaSourcePlan | null;
}

export function planProjectRender(project: unknown, opts: ProjectRenderPlanOptions = {}): ProjectRenderPlan {
  const effectiveRange = resolveProjectRenderRange(project, opts.range ?? null, opts.renderWholeProject ?? false);
  const mediaUsage = collectProjectMediaUsage(project, effectiveRange);

  return {
    effectiveRange,
    mediaUsage,
    mediaSourcePlan: opts.mediaSources === undefined
      ? null
      : planRenderMediaSources(mediaUsage.keys(), opts.mediaSources),
  };
}

export function resolveProjectRenderRange(
  project: unknown,
  requestedRange?: RenderRangeInput | null,
  renderWholeProject = false,
): FrameRange | null {
  if (renderWholeProject) return null;
  const projectRecord = asRecord(project);
  const metadata = asRecord(projectRecord?.metadata);
  const timeline = asRecord(projectRecord?.timeline);
  const fps = typeof metadata?.fps === 'number' ? metadata.fps : 30;

  if (requestedRange) return resolveRangeFrames(requestedRange, fps);

  const inPoint = timeline?.inPoint;
  const outPoint = timeline?.outPoint;
  if (typeof inPoint === 'number' && typeof outPoint === 'number') {
    return validateRangeFrames(inPoint, outPoint);
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}
