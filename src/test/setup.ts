import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { resetAutoKeyframeStore } from '@/features/keyframes/stores/auto-keyframe-store';

// Mock ImageData for Canvas operations
type TestGlobalWithImageData = typeof globalThis & { ImageData?: typeof ImageData };
const testGlobal = globalThis as TestGlobalWithImageData;

if (typeof testGlobal.ImageData === 'undefined') {
  class MockImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;

    constructor(
      dataOrWidth: Uint8ClampedArray | number,
      widthOrHeight: number,
      height?: number
    ) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? Math.floor(dataOrWidth.length / (widthOrHeight * 4));
      }
    }
  }

  testGlobal.ImageData = MockImageData as unknown as typeof ImageData;
}

function hasUsableLocalStorage(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return (
      Boolean(window.localStorage) &&
      typeof window.localStorage.getItem === 'function' &&
      typeof window.localStorage.removeItem === 'function'
    );
  } catch {
    return false;
  }
}

if (!hasUsableLocalStorage()) {
  const values = new Map<string, string>();
  const localStorage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(String(key)) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(String(key));
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value));
    },
  } satisfies Storage;

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  });
}

afterEach(() => {
  resetAutoKeyframeStore();
});
