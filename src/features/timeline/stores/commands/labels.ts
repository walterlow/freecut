import type { TimelineCommand } from './types';

function toTitleCaseWords(input: string): string {
  return input
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readCount(payload: Record<string, unknown> | undefined): number | null {
  if (!payload) return null;

  if (typeof payload.count === 'number' && Number.isFinite(payload.count)) {
    return Math.max(1, Math.round(payload.count));
  }

  if (Array.isArray(payload.ids)) {
    return Math.max(1, payload.ids.length);
  }

  if (typeof payload.id === 'string' && payload.id.length > 0) {
    return 1;
  }

  return null;
}

function formatTransformLabel(command: TimelineCommand): string {
  const payload = command.payload;
  const operation = typeof payload?.operation === 'string' ? payload.operation : 'transform';
  const count = readCount(payload);
  const noun = count === null || count === 1 ? 'item' : `${count} items`;

  switch (operation) {
    case 'move':
      return `Move ${noun}`;
    case 'resize':
      return `Resize ${noun}`;
    case 'rotate':
      return `Rotate ${noun}`;
    case 'opacity':
      return `Adjust opacity (${noun})`;
    case 'corner_radius':
      return `Adjust corner radius (${noun})`;
    default:
      return `Transform ${noun}`;
  }
}

export function formatTimelineCommandLabel(command: TimelineCommand): string {
  if (command.type === 'UPDATE_TRANSFORM' || command.type === 'UPDATE_TRANSFORMS') {
    return formatTransformLabel(command);
  }

  if (command.type === 'APPLY_AUTO_KEYFRAME_OPERATIONS') {
    const count = readCount(command.payload);
    if (count !== null) {
      return `Auto-keyframe ${count} ${count === 1 ? 'property' : 'properties'}`;
    }
    return 'Auto-keyframe properties';
  }

  if (command.type === 'APPLY_BENTO_LAYOUT') {
    const count = readCount(command.payload);
    if (count !== null) {
      return `Apply bento layout (${count} ${count === 1 ? 'item' : 'items'})`;
    }
    return 'Apply bento layout';
  }

  if (command.type === 'SET_IN_POINT') return 'Set In point';
  if (command.type === 'SET_OUT_POINT') return 'Set Out point';
  if (command.type === 'CLEAR_IN_OUT_POINTS') return 'Clear In/Out points';
  if (command.type === 'CLEAR_MARKERS') return 'Clear markers';
  if (command.type === 'CLEAR_TIMELINE') return 'Clear timeline';

  const count = readCount(command.payload);
  const base = toTitleCaseWords(command.type);
  if (count !== null && count > 1) {
    return `${base} (${count})`;
  }
  return base;
}

