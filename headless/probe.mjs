// Probe: does headless Chrome expose WebGPU + WebCodecs encoders we need?
// Run: node headless/probe.mjs        (headless)
//      node headless/probe.mjs --head (headed, for comparison)
import { chromium } from 'playwright'
import { chromeLaunchArgs } from './lib/cli.mjs'

const HEADED = process.argv.includes('--head')

const probeInPage = async () => {
  const out = {}

  // OffscreenCanvas + 2D
  out.offscreenCanvas = typeof OffscreenCanvas !== 'undefined'
  out.offlineAudioContext = typeof OfflineAudioContext !== 'undefined'

  // WebGPU
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {}
        const device = await adapter.requestDevice()
        out.webgpu = {
          ok: !!device,
          vendor: info.vendor ?? '',
          architecture: info.architecture ?? '',
          description: info.description ?? '',
        }
      } else {
        out.webgpu = { ok: false, reason: 'requestAdapter() returned null' }
      }
    } catch (e) {
      out.webgpu = { ok: false, reason: String(e) }
    }
  } else {
    out.webgpu = { ok: false, reason: 'navigator.gpu undefined' }
  }

  // WebCodecs video encoders
  const codecConfigs = {
    'h264-L3.0': { codec: 'avc1.42E01E' },
    'h264-baseline-L4.0': { codec: 'avc1.42E028' },
    'h264-main-L4.0': { codec: 'avc1.4D4028' },
    'h264-high-L4.0': { codec: 'avc1.640028' },
    hevc: { codec: 'hvc1.1.6.L93.B0' },
    vp9: { codec: 'vp09.00.10.08' },
    av1: { codec: 'av01.0.04M.08' },
  }
  out.videoEncode = {}
  if (typeof VideoEncoder !== 'undefined') {
    for (const [name, cfg] of Object.entries(codecConfigs)) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          ...cfg,
          width: 1920,
          height: 1080,
          bitrate: 5_000_000,
          framerate: 30,
        })
        out.videoEncode[name] = !!support.supported
      } catch (e) {
        out.videoEncode[name] = `error: ${String(e)}`
      }
    }
  } else {
    out.videoEncode = 'VideoEncoder undefined'
  }

  out.audioEncode = {}
  if (typeof AudioEncoder !== 'undefined') {
    for (const [name, codec] of Object.entries({ aac: 'mp4a.40.2', opus: 'opus' })) {
      try {
        const support = await AudioEncoder.isConfigSupported({
          codec,
          sampleRate: 48000,
          numberOfChannels: 2,
          bitrate: 128_000,
        })
        out.audioEncode[name] = !!support.supported
      } catch (e) {
        out.audioEncode[name] = `error: ${String(e)}`
      }
    }
  } else {
    out.audioEncode = 'AudioEncoder undefined'
  }

  return out
}

const main = async () => {
  console.log(`Launching Chrome (channel=chrome, headless=${!HEADED}) ...`)
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !HEADED,
    args: chromeLaunchArgs(),
  })
  try {
    const page = await browser.newPage()
    page.on('console', (m) => console.log('  [page]', m.text()))
    // WebGPU + WebCodecs are [SecureContext]-gated. data: URLs are NOT secure
    // contexts, but localhost is. Fulfill a localhost document via route so we
    // get a secure-context origin without standing up a real server.
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>probe</title>' }),
    )
    await page.goto('http://localhost/')
    const result = await page.evaluate(probeInPage)
    console.log('  isSecureContext:', await page.evaluate(() => self.isSecureContext))
    console.log('\n=== PROBE RESULT ===')
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
