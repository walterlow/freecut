# Live AI (real-time AI pipelines)

This feature provides **real-time per-frame AI** in the UI: broadcast webcam (or other input) and view the AI-processed output live in the browser.

## Architecture: Daydream / ComfyStream

We use **Daydream** (ComfyStream-style): create a stream via the Daydream API, send input via **WHIP** (WebRTC), and play output via **WHEP**. No server-side stream URLs required; everything is browser → Daydream → browser.

- **Create stream**: `POST` to Daydream API with pipeline (e.g. `streamdiffusion`) and params → get `whip_url` and `output_playback_id`.
- **Input**: Browser captures media (e.g. webcam), sends it to `whip_url` via WHIP using `@daydreamlive/react` `useBroadcast`.
- **Output**: Resolve WHEP URL from Livepeer playback API using `output_playback_id`, then play with `usePlayer`.

This matches the docs’ recommendation for **real-time per-frame AI effects in a UI** (style transfer, face animation, etc.) and is the same foundation as products like Daydream. See:

- [ComfyStream integration](/v2/developers/ai-pipelines/comfystream)
- [AI Pipelines overview](/v2/developers/ai-pipelines/overview)

## Alternative: Livepeer live-video-to-video API

Livepeer also exposes a **live-video-to-video** endpoint that takes **stream URLs** instead of browser WHIP:

- `POST https://livepeer.studio/api/beta/generate/live-video-to-video`
- Body: `subscribe_url` (input stream), `publish_url` (output stream), optional `control_url` / `events_url`, `model_id`, `params`.
- Response: URLs your backend or players use for ingest/playback.

That flow is for **server-side streams** (e.g. RTMP ingest → AI → RTMP/HLS out). There is no step-by-step frontend/UI guide for it in the docs; it assumes you already have subscribe/publish endpoints. Use it when you own or run the ingest/publish stack.

- [Live Video to Video API reference](/v2/gateways/references/api-reference/AI-API/live-video-to-video)

## Livepeer AI API (reference for future use)

If we add features that call the Livepeer AI gateway (text-to-image, live-video-to-video, image-to-video, etc.):

| Environment | Base URL | Auth |
|-------------|----------|------|
| **Livepeer Studio** | `https://livepeer.studio/api/beta/generate` | `Authorization: Bearer <LIVEPEER_STUDIO_API_KEY>` |
| **Cloud SPE Community** | `https://tools.livepeer.cloud` | See provider docs |

Endpoint paths are consistent across deployments; use the base URL + path (e.g. `/text-to-image`, `/live-video-to-video`). Live AI Studio does not call these today; it uses the Daydream API only.

## LoRAs (Daydream Cloud)

LoRAs (Low-Rank Adaptations) are supported via the Daydream Cloud API’s `lora_dict` parameter for **SD / SDXL / SD1.5** models (StreamDiffusion pipeline).

- **Create stream**: Optional `params.lora_dict` — object mapping LoRA path or identifier to weight (e.g. `{ "path/to/lora.safetensors": 0.8 }`). Live AI Studio lets you add one or more LoRAs (path/URL + scale) before creating a stream.
- **Update stream**: You can change LoRAs on an existing stream via PATCH; updating `lora_dict` triggers a pipeline reload (~30s). Use “Apply LoRAs” in the UI.
- **Scale**: Valid range in the UI is 0.1–2. Many LoRAs use a trigger phrase in the prompt; check the LoRA’s docs (e.g. [Daydream LoRAs](https://docs.daydream.live/scope/guides/loras)) and add it to your style prompt if needed.

**Wan2.1 LoRAs** (LongLive, Krea Realtime, etc.) use Scope’s load-pipeline format (`loras: [{ path, scale }]`) and require a self-hosted Scope instance (e.g. RunPod), not the Daydream Cloud API. They are not supported in this feature today.

## This feature

- **Where**: Available in the editor via the **Live AI Studio** sidebar tab (media sidebar).
- **Config**: `VITE_DAYDREAM_API_KEY` in `.env.local` (dev). For production, create streams via a backend so the key is not exposed.
- **Dev CORS**: WHIP requests are proxied through the Vite dev server (`/api/whip-proxy`) so the browser never hits Livepeer’s redirect-on-preflight; see `vite.config.ts` and `toProxyWhipUrlIfNeeded` in the Live AI Studio panel.
