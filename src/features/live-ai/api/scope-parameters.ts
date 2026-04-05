/**
 * Scope local server: parameter updates via WebRTC data channel.
 * Zero-latency parameter changes (prompts, denoising steps, etc.)
 * are sent directly over the data channel, bypassing HTTP entirely.
 *
 * All public update functions are throttled (trailing edge, 60ms) to prevent
 * overwhelming the Scope server's parameter queue when users drag sliders.
 */

import { throttle } from '../utils/throttle';

export interface ScopePrompt {
  text: string;
  weight: number;
}

export interface ScopeParameterUpdate {
  prompts?: ScopePrompt[];
  denoising_step_list?: number[];
  manage_cache?: boolean;
  [key: string]: unknown;
}

/** Raw send — not throttled. Internal use only. */
function sendRaw(dataChannel: RTCDataChannel, params: ScopeParameterUpdate): boolean {
  if (dataChannel.readyState !== 'open') return false;
  try {
    dataChannel.send(JSON.stringify(params));
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a parameter update to Scope via the WebRTC data channel.
 * Returns true if the message was sent, false if the channel is not ready.
 */
export function sendScopeParameters(
  dataChannel: RTCDataChannel,
  params: ScopeParameterUpdate,
): boolean {
  return sendRaw(dataChannel, params);
}

/**
 * Update the prompt on a live Scope session.
 * Sends immediately via data channel for zero-latency feedback.
 */
export function updateScopePrompt(
  dataChannel: RTCDataChannel,
  prompt: string,
  weight = 1.0,
): boolean {
  return sendRaw(dataChannel, {
    prompts: [{ text: prompt, weight }],
  });
}

/**
 * Update denoising steps on a live Scope session.
 */
export function updateScopeDenoisingSteps(
  dataChannel: RTCDataChannel,
  steps: number[],
): boolean {
  return sendRaw(dataChannel, {
    denoising_step_list: steps,
  });
}

// ---------------------------------------------------------------------------
// Throttled variants for continuous UI controls (sliders, color pickers, etc.)
// 60ms trailing-edge throttle ≈ 16 updates/sec — plenty for visual feedback
// without flooding the Scope server's parameter queue.
// ---------------------------------------------------------------------------

const THROTTLE_MS = 60;

/**
 * Per-key throttle map for dynamic pipeline parameters.
 * Each parameter key (e.g. "denoising_strength", "guidance_scale") gets its own
 * 60ms trailing-edge throttle so simultaneous slider drags don't starve each other.
 */
const dynamicParamThrottles = new Map<string, ReturnType<typeof throttle>>();

function getOrCreateParamThrottle(key: string) {
  let fn = dynamicParamThrottles.get(key);
  if (!fn) {
    fn = throttle(
      (dataChannel: RTCDataChannel, value: unknown) =>
        sendRaw(dataChannel, { [key]: value }),
      THROTTLE_MS,
    );
    dynamicParamThrottles.set(key, fn);
  }
  return fn;
}

/**
 * Throttled: send an arbitrary parameter update from dynamic schema-driven controls.
 * Safe to call on every slider `onChange` — each key gets its own 60ms throttle
 * so dragging slider A never delays slider B's updates.
 */
export function updateScopeDynamicParam(
  dataChannel: RTCDataChannel,
  key: string,
  value: unknown,
): boolean {
  const throttled = getOrCreateParamThrottle(key);
  throttled(dataChannel, value);
  return true;
}

/**
 * Throttled prompt update — used when auto-apply is on and the user is typing.
 */
export const updateScopePromptThrottled = throttle(
  (dataChannel: RTCDataChannel, prompt: string) =>
    sendRaw(dataChannel, { prompts: [{ text: prompt, weight: 1.0 }] }),
  THROTTLE_MS,
);
