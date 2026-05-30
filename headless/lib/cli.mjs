// Shared CLI helpers for the headless scripts: argv parsing + Chrome launch args.

/** Parse `--key value` / boolean `--flag` argv into an object; positionals go in `_`. */
export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) args[key] = true
      else {
        args[key] = next
        i++
      }
    } else {
      args._.push(token)
    }
  }
  return args
}

/**
 * Chrome launch args for headless WebGPU, per platform. The ANGLE backend is
 * platform-specific (d3d11 on Windows, metal on macOS, vulkan on Linux). Extra
 * args can be appended via FREECUT_CHROME_ARGS (space-separated) — e.g. in
 * Docker: "--no-sandbox --use-vulkan=swiftshader" for software WebGPU.
 */
export function chromeLaunchArgs() {
  // Full override (space-separated) — for tuning the GPU/WebGPU backend, esp.
  // in containers (e.g. SwiftShader). Replaces ALL args including the defaults.
  const replace = process.env.FREECUT_CHROME_ARGS_REPLACE
  if (replace) return replace.split(/\s+/).filter(Boolean)

  const angle =
    process.platform === 'win32'
      ? '--use-angle=d3d11'
      : process.platform === 'darwin'
        ? '--use-angle=metal'
        : '--use-angle=vulkan'
  const base = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', angle]
  const extra = (process.env.FREECUT_CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)
  return [...base, ...extra]
}
