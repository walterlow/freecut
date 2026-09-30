import '@testing-library/jest-dom'
import { afterEach } from 'vite-plus/test'
import i18n from 'i18next'
import '@/i18n'

void i18n.changeLanguage('en')

import { resetAutoKeyframeStore } from '@/features/keyframes/stores/auto-keyframe-store'

// Mock ImageData for Canvas operations
type TestGlobalWithImageData = typeof globalThis & { ImageData?: typeof ImageData }
const testGlobal = globalThis as TestGlobalWithImageData

if (typeof testGlobal.ImageData === 'undefined') {
  class MockImageData {
    width: number
    height: number
    data: Uint8ClampedArray

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth
        this.height = widthOrHeight
        this.data = new Uint8ClampedArray(this.width * this.height * 4)
      } else {
        this.data = dataOrWidth
        this.width = widthOrHeight
        this.height = height ?? Math.floor(dataOrWidth.length / (widthOrHeight * 4))
      }
    }
  }

  testGlobal.ImageData = MockImageData as unknown as typeof ImageData
}

// Mock ResizeObserver — jsdom omits it; components that measure natural height
// (e.g. the shortcuts dialog command list) construct one on mount.
type TestGlobalWithResizeObserver = typeof globalThis & { ResizeObserver?: typeof ResizeObserver }
const testGlobalRO = globalThis as TestGlobalWithResizeObserver

if (typeof testGlobalRO.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  testGlobalRO.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
}

// Node 22+ / 26 defines an experimental localStorage getter on globalThis that returns undefined
// if --localstorage-file is not provided, breaking zustand/persist and jsdom storage lookups.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const memoryStore = new Map<string, string>()
  const mockStorage = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, String(value))
    },
    removeItem: (key: string) => {
      memoryStore.delete(key)
    },
    clear: () => {
      memoryStore.clear()
    },
    key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
    get length() {
      return memoryStore.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  resetAutoKeyframeStore()
})
