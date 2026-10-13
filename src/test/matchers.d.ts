import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import 'vite-plus/test'

// jest-dom 6 declares Jest/v4 assertions; Vitest 5 uses return and received types.
declare module 'vitest' {
  interface Matchers<R, T> extends TestingLibraryMatchers<T, R> {}
}
