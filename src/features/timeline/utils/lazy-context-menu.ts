export interface LazyContextMenuEventInit {
  clientX: number
  clientY: number
  screenX: number
  screenY: number
  button: number
  buttons: number
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function captureContextMenuEventInit(
  event: Pick<
    MouseEvent,
    | 'clientX'
    | 'clientY'
    | 'screenX'
    | 'screenY'
    | 'button'
    | 'buttons'
    | 'ctrlKey'
    | 'shiftKey'
    | 'altKey'
    | 'metaKey'
  >,
): LazyContextMenuEventInit {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  }
}

export function replayContextMenuEvent(
  target: HTMLElement,
  eventInit: LazyContextMenuEventInit,
): void {
  const MouseEventCtor = target.ownerDocument.defaultView?.MouseEvent
  if (!MouseEventCtor) {
    return
  }

  target.dispatchEvent(
    new MouseEventCtor('contextmenu', {
      bubbles: true,
      cancelable: true,
      ...eventInit,
    }),
  )
}
