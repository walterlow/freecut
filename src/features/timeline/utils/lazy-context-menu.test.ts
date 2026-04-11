import { describe, expect, it, vi } from 'vitest';
import {
  captureContextMenuEventInit,
  replayContextMenuEvent,
} from './lazy-context-menu';

describe('lazy-context-menu', () => {
  it('captures and replays a contextmenu event with pointer coordinates and modifiers intact', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const handler = vi.fn((event: MouseEvent) => {
      expect(event.type).toBe('contextmenu');
      expect(event.clientX).toBe(180);
      expect(event.clientY).toBe(96);
      expect(event.screenX).toBe(420);
      expect(event.screenY).toBe(240);
      expect(event.button).toBe(2);
      expect(event.buttons).toBe(2);
      expect(event.ctrlKey).toBe(true);
      expect(event.shiftKey).toBe(true);
      expect(event.altKey).toBe(false);
      expect(event.metaKey).toBe(false);
    });

    target.addEventListener('contextmenu', handler);

    const eventInit = captureContextMenuEventInit({
      clientX: 180,
      clientY: 96,
      screenX: 420,
      screenY: 240,
      button: 2,
      buttons: 2,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });

    replayContextMenuEvent(target, eventInit);

    expect(handler).toHaveBeenCalledTimes(1);

    target.remove();
  });
});
