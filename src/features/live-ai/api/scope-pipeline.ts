/**
 * Scope local server: pipeline loading and schema discovery.
 * Uses REST endpoints for pipeline management; parameter updates go via WebRTC data channel.
 */

import { getScopeBaseUrl } from './scope-health';
import type { ScopePipeline } from '../config/scope-pipelines';

export interface PipelineParamSchema {
  name: string;
  type: 'number' | 'boolean' | 'string' | 'array';
  description?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  enum?: string[];
}

export interface PipelineSchemas {
  [pipelineName: string]: PipelineParamSchema[];
}

/**
 * Load a pipeline on the Scope server. Triggers model download if needed.
 * This can take 30s+ for first-time loads (model download + VRAM allocation).
 */
export async function loadScopePipeline(pipeline: ScopePipeline): Promise<void> {
  const res = await fetch(`${getScopeBaseUrl()}/api/v1/pipeline/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipeline: pipeline.id }),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `Scope pipeline load failed (${res.status})`;
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      message = json.message ?? json.error ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
}

/**
 * Fetch parameter schemas for all loaded pipelines.
 * Used to dynamically render parameter controls in the sidebar.
 */
export async function getScopePipelineSchemas(): Promise<PipelineSchemas> {
  const res = await fetch(`${getScopeBaseUrl()}/api/v1/pipelines/schemas`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) return {};

  const data = (await res.json()) as Record<string, unknown>;

  // Normalize the schema response into our typed format
  const schemas: PipelineSchemas = {};
  for (const [name, rawSchema] of Object.entries(data)) {
    if (!Array.isArray(rawSchema)) continue;
    schemas[name] = (rawSchema as Record<string, unknown>[]).map((field) => ({
      name: String(field.name ?? ''),
      type: normalizeParamType(field.type),
      description: typeof field.description === 'string' ? field.description : undefined,
      default: field.default,
      min: typeof field.min === 'number' ? field.min : undefined,
      max: typeof field.max === 'number' ? field.max : undefined,
      step: typeof field.step === 'number' ? field.step : undefined,
      enum: Array.isArray(field.enum) ? field.enum.map(String) : undefined,
    }));
  }

  return schemas;
}

function normalizeParamType(raw: unknown): PipelineParamSchema['type'] {
  const str = String(raw).toLowerCase();
  if (str === 'number' || str === 'float' || str === 'int' || str === 'integer') return 'number';
  if (str === 'boolean' || str === 'bool') return 'boolean';
  if (str === 'array' || str === 'list') return 'array';
  return 'string';
}

/**
 * Download a model on the Scope server (if not already cached).
 */
export async function downloadScopeModel(modelId: string): Promise<void> {
  const res = await fetch(`${getScopeBaseUrl()}/api/v1/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: modelId }),
  });

  if (!res.ok) {
    throw new Error(`Model download failed (${res.status})`);
  }
}

/**
 * Get ICE server configuration for WebRTC.
 */
export async function getScopeIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${getScopeBaseUrl()}/api/v1/webrtc/ice-servers`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as RTCIceServer[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
