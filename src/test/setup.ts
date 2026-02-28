import '@testing-library/jest-dom';

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
