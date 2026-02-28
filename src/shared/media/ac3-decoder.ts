/**
 * Shared AC-3 decoder registration helpers.
 *
 * Keeps @mediabunny/ac3 loading behind an explicit call site so normal
 * AAC/MP3 paths avoid downloading the decoder bundle.
 */

const AC3_CODEC_PATTERN = /(^|[^a-z0-9])(ac-?3|ec-?3|e-?ac-?3|eac3)([^a-z0-9]|$)/i;

let ac3RegistrationPromise: Promise<void> | null = null;

export function isAc3AudioCodec(audioCodec: string | undefined): boolean {
  if (!audioCodec) return false;

  const normalized = audioCodec.toLowerCase().trim();
  if (AC3_CODEC_PATTERN.test(normalized)) return true;

  const separatorNormalized = normalized.replace(/[_-]+/g, ' ');
  return separatorNormalized.includes('dolby digital');
}

export async function ensureAc3DecoderRegistered(): Promise<void> {
  if (!ac3RegistrationPromise) {
    ac3RegistrationPromise = (async () => {
      const { registerAc3Decoder } = await import('@mediabunny/ac3');
      try {
        registerAc3Decoder();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/already registered/i.test(message)) {
          throw err;
        }
      }
    })();
  }

  return ac3RegistrationPromise;
}
