/**
 * Registers the `@mediabunny/prores` custom decoder into mediabunny's decoder registry
 * for the current JS realm.
 *
 * Browsers have no ProRes support in their WebCodecs implementation, so mediabunny's
 * sinks (`VideoSampleSink`, `CanvasSink`) and `Conversion` normally can't touch a ProRes
 * track. The extension plugs a TurboRes-backed WASM decoder into the registry; once
 * registered, `videoTrack.canDecode()` reports ProRes as decodable and the native sinks
 * decode it directly — no bespoke decode bridge needed.
 *
 * Registration is a realm-global toggle, so this must be called in **every** context that
 * decodes ProRes (the main thread plus each decode worker), before the first decode. It is
 * idempotent: the module-level guard here and the extension's own guard make repeat calls
 * cheap no-ops. The dynamic import keeps the extension (and its WASM decoder) out of bundles
 * for contexts that never call this.
 *
 * NOTE: registering flips `canDecode()` to `true` for ProRes. Any code that uses
 * `canDecode()` to mean "a browser `<video>` element can play this" (e.g. the import-time
 * `videoCodecSupported` probe that routes preview to the live-decode canvas) must guard on
 * the codec explicitly rather than relying on `canDecode()` — ProRes is decodable by us but
 * still not playable in a `<video>` element. Deliberately NOT called in the DOM-video
 * decoder-prewarm worker, whose `canDecode()` gate must keep skipping ProRes.
 */

let registerPromise: Promise<void> | null = null

export function ensureProResDecoderRegistered(): Promise<void> {
  if (!registerPromise) {
    registerPromise = import('@mediabunny/prores')
      .then(({ registerProresDecoder }) => {
        registerProresDecoder()
      })
      .catch((error: unknown) => {
        // Clear the guard so a transient failure (e.g. a failed dynamic import) doesn't
        // permanently block ProRes decoding in this realm — the next call can retry.
        registerPromise = null
        throw error
      })
  }
  return registerPromise
}
