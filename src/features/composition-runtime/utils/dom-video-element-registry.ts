const videoElementsByItemId = new Map<string, Set<HTMLVideoElement>>();

function getOrCreateItemElements(itemId: string): Set<HTMLVideoElement> {
  const existing = videoElementsByItemId.get(itemId);
  if (existing) return existing;

  const next = new Set<HTMLVideoElement>();
  videoElementsByItemId.set(itemId, next);
  return next;
}

export function registerDomVideoElement(itemId: string, element: HTMLVideoElement): void {
  getOrCreateItemElements(itemId).add(element);
}

export function unregisterDomVideoElement(itemId: string, element: HTMLVideoElement): void {
  const itemElements = videoElementsByItemId.get(itemId);
  if (!itemElements) return;

  itemElements.delete(element);
  if (itemElements.size === 0) {
    videoElementsByItemId.delete(itemId);
  }
}

export function clearDomVideoElementRegistry(): void {
  videoElementsByItemId.clear();
}
