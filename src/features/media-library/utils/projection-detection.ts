/**
 * Video projection format detection utilities.
 *
 * Differentiates between:
 * - 'spherical_360': True equirectangular 360° video (Google Spatial Media, sv3d/st3d boxes, Insta360 360 cameras).
 * - 'ultrawide': Flat video shot with an ultra-wide / action cam lens or wide aspect ratio (>= 1.85:1, 21:9, 2:1, etc.).
 * - 'standard': Standard planar rectilinear video (16:9, 4:3, etc.).
 */

const GOOGLE_SPHERICAL_UUID = new Uint8Array([
  0xff, 0xcc, 0x82, 0x63, 0xf8, 0x55, 0x4a, 0x93, 0x88, 0x14, 0x58, 0x7a, 0x02, 0x52, 0x1f, 0xdd,
])

function bufferContainsSequence(buffer: Uint8Array, sequence: Uint8Array): boolean {
  if (sequence.length === 0 || buffer.length < sequence.length) return false
  const limit = buffer.length - sequence.length
  for (let i = 0; i <= limit; i++) {
    let match = true
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

function bufferContainsAscii(buffer: Uint8Array, asciiStr: string): boolean {
  const enc = new TextEncoder()
  return bufferContainsSequence(buffer, enc.encode(asciiStr))
}

async function readBlobSliceAsUint8Array(blob: Blob, start: number, end: number): Promise<Uint8Array | null> {
  try {
    const slice = blob.slice(start, end)
    if (typeof slice.arrayBuffer === 'function') {
      const ab = await slice.arrayBuffer()
      return new Uint8Array(ab)
    }
    if (typeof FileReader !== 'undefined') {
      return await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
        reader.onerror = reject
        reader.readAsArrayBuffer(slice)
      })
    }
  } catch {
    // Return null if reading fails
  }
  return null
}

export type VideoProjectionType = 'spherical_360' | 'ultrawide' | 'standard'

export async function detectVideoProjectionFormat(
  file: File | Blob,
  width = 0,
  height = 0,
): Promise<VideoProjectionType> {
  const fileName = 'name' in file ? (file as File).name.toLowerCase() : ''

  // Fast check: Read head (first 128KB) and tail (last 128KB where moov/trailer metadata often sits)
  const headBytes = await readBlobSliceAsUint8Array(file, 0, 131072)
  if (headBytes) {
    const hasSphericalBox =
      bufferContainsAscii(headBytes, 'sv3d') ||
      bufferContainsAscii(headBytes, 'st3d') ||
      bufferContainsSequence(headBytes, GOOGLE_SPHERICAL_UUID) ||
      bufferContainsAscii(headBytes, 'GSpherical')

    if (hasSphericalBox) {
      return 'spherical_360'
    }
  }

  if (file.size > 262144) {
    const tailBytes = await readBlobSliceAsUint8Array(file, file.size - 131072, file.size)
    if (tailBytes) {
      const hasTailSpherical =
        bufferContainsAscii(tailBytes, 'sv3d') ||
        bufferContainsAscii(tailBytes, 'st3d') ||
        bufferContainsSequence(tailBytes, GOOGLE_SPHERICAL_UUID) ||
        bufferContainsAscii(tailBytes, 'GSpherical')

      if (hasTailSpherical) {
        return 'spherical_360'
      }
    }
  }

  // Dual-lens 360 filenames from Insta360 (usually contain 360, x2, x3, x4, onex, sphere)
  if (
    fileName.includes('360') ||
    fileName.includes('_onex') ||
    fileName.includes('onex2') ||
    fileName.includes('onex3') ||
    fileName.includes('onex4') ||
    fileName.includes('sphere')
  ) {
    return 'spherical_360'
  }

  // Single-lens Insta360 cameras (Ace, Ace Pro, GO 2, GO 3) shoot flat ultrawide video
  if (fileName.endsWith('.insv') || fileName.endsWith('.insp')) {
    return 'ultrawide'
  }

  // Aspect ratio check:
  // Ultrawide includes >= 1.85:1 (e.g. 21:9 = ~2.33, 2:1 = 2.0, 2.35:1, 2.39:1)
  if (width > 0 && height > 0) {
    const aspect = width / height
    if (aspect >= 1.85) {
      return 'ultrawide'
    }
  }

  // Filename hints for action / ultrawide cameras
  if (
    fileName.includes('ultrawide') ||
    fileName.includes('ultra_wide') ||
    fileName.includes('superview') ||
    fileName.includes('hyperview') ||
    fileName.includes('freeframe') ||
    fileName.includes('actionview') ||
    fileName.includes('ace_pro') ||
    fileName.includes('acepro') ||
    fileName.includes('gopro')
  ) {
    return 'ultrawide'
  }

  return 'standard'
}
