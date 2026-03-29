import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDomVideoElementRegistry,
  getBestDomVideoElementForItem,
  registerDomVideoElement,
  unregisterDomVideoElement,
} from './dom-video-element-registry';

function createConnectedVideo({
  readyState,
  videoWidth,
}: {
  readyState: number;
  videoWidth: number;
}): HTMLVideoElement {
  const element = document.createElement('video');
  Object.defineProperty(element, 'readyState', {
    configurable: true,
    get: () => readyState,
  });
  Object.defineProperty(element, 'videoWidth', {
    configurable: true,
    get: () => videoWidth,
  });
  document.body.appendChild(element);
  return element;
}

describe('dom-video-element-registry', () => {
  afterEach(() => {
    clearDomVideoElementRegistry();
    document.body.innerHTML = '';
  });

  it('returns the best-ready connected element for an item id', () => {
    const lowReady = createConnectedVideo({ readyState: 2, videoWidth: 1920 });
    const highReady = createConnectedVideo({ readyState: 4, videoWidth: 1920 });

    registerDomVideoElement('clip-1', lowReady);
    registerDomVideoElement('clip-1', highReady);

    expect(getBestDomVideoElementForItem('clip-1')).toBe(highReady);
  });

  it('ignores disconnected elements and prunes stale entries', () => {
    const stale = createConnectedVideo({ readyState: 4, videoWidth: 1920 });
    registerDomVideoElement('clip-1', stale);
    stale.remove();

    expect(getBestDomVideoElementForItem('clip-1')).toBeNull();
    expect(getBestDomVideoElementForItem('clip-1')).toBeNull();
  });

  it('removes elements from the item registry on unregister', () => {
    const element = createConnectedVideo({ readyState: 4, videoWidth: 1920 });
    registerDomVideoElement('clip-1', element);

    unregisterDomVideoElement('clip-1', element);

    expect(getBestDomVideoElementForItem('clip-1')).toBeNull();
  });
});
