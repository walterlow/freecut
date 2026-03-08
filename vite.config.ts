import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

const WHIP_PROXY_PREFIX = '/api/whip-proxy'

/** Dev-only: handle CORS preflight for WHIP proxy so browser doesn't hit Livepeer's redirect on OPTIONS */
function whipProxyCorsPlugin() {
  return {
    name: 'whip-proxy-cors',
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        if (req.method === 'OPTIONS' && req.url?.startsWith(WHIP_PROXY_PREFIX)) {
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
          res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT, DELETE')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          res.setHeader('Access-Control-Max-Age', '86400')
          res.statusCode = 200
          res.end()
          return
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Polyfill Node stdlib (buffer, etc.) for browser - required by @account-kit deps (elliptic, bn.js, @solana/web3.js)
    nodePolyfills(),
    whipProxyCorsPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      [WHIP_PROXY_PREFIX]: {
        target: 'https://ai.livepeer.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(WHIP_PROXY_PREFIX, ''),
        secure: true,
        configure: (proxy: {
          on: (event: string, fn: (proxyRes: any, req: any, res: any) => void) => void
        }) => {
          proxy.on('proxyRes', (proxyRes: any, req: any) => {
            // Rewrite redirect Location so the client stays on our origin (avoids CORS on follow)
            if (proxyRes.statusCode >= 301 && proxyRes.statusCode < 400 && proxyRes.headers['location']) {
              const loc = proxyRes.headers['location']
              const origin = `http://${req.headers.host || 'localhost:5173'}`
              try {
                if (loc.includes('livepeer.com')) {
                  const u = new URL(loc)
                  proxyRes.headers['location'] = `${origin}${WHIP_PROXY_PREFIX}${u.pathname}${u.search}`
                } else if (loc.startsWith('/')) {
                  proxyRes.headers['location'] = `${origin}${WHIP_PROXY_PREFIX}${loc}`
                }
              } catch {
                // leave Location unchanged if URL parse fails
              }
            }
          })
        },
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // @mediabunny/ac3 is an intentionally large lazy decoder bundle (~1.1 MB minified).
    // Keep warnings focused on unexpected growth rather than this known outlier.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Logger must be in its own chunk to avoid circular chunk TDZ errors.
          // Without this, Rollup places it in composition-runtime which has a
          // circular import with media-library, causing "Cannot access before
          // initialization" in production builds.
          if (id.endsWith('src/shared/logging/logger.ts')) {
            return 'core-logger';
          }

          // Application feature chunks
          if (id.includes('/src/features/timeline/') || id.includes('/src/features/media-library/')) {
            // Split UI from editing domain/runtime modules to reduce initial chunk pressure.
            // Keep stores/services/utils/deps/contracts together to preserve execution order
            // for tightly-coupled timeline/media-library integration points.
            if (id.includes('/components/')) {
              return 'feature-editing-ui';
            }
            return 'feature-editing-core';
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects';
          }
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-composition-runtime';
          }

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          // Router framework
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor';
          }
          // State management
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor';
          }
          // Media processing - loaded on demand
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder';
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder';
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core';
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing';
          }
          // Audio/video processing helpers
          if (id.includes('/node_modules/soundtouchjs/')) {
            return 'audio-processing';
          }
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing';
          }
          // Wallet / Account Kit – separate chunk so main bundle stays smaller and wallet code is cacheable
          if (
            id.includes('@account-kit/') ||
            id.includes('/wagmi/') ||
            id.includes('@reown/') ||
            id.includes('@walletconnect/') ||
            id.includes('@coinbase/wallet-sdk') ||
            id.includes('/viem/')
          ) {
            return 'wallet-vendor';
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui';
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mediabunny', '@mediabunny/ac3', '@mediabunny/mp3-encoder'],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
})
