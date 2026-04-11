import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useSelectionStore } from '@/shared/state/selection';
import { ItemContextMenu } from './item-context-menu';

const { mockGetSceneVerificationModelOptions } = vi.hoisted(() => ({
  mockGetSceneVerificationModelOptions: vi.fn(() => [
    { value: 'gemma', label: 'Gemma Turbo' },
    { value: 'lfm', label: 'Liquid Vision' },
  ]),
}));

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ContextMenuSeparator: () => null,
  ContextMenuShortcut: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/timeline/deps/analysis', () => ({
  getSceneVerificationModelOptions: mockGetSceneVerificationModelOptions,
}));

vi.mock('@/features/timeline/deps/media-transcription-service', () => ({
  getMediaTranscriptionModelLabel: (model: string) => model,
  getMediaTranscriptionModelOptions: () => [],
}));

vi.mock('@/features/timeline/deps/settings', () => ({
  useResolvedHotkeys: () => ({}),
}));

vi.mock('@/config/hotkeys', () => ({
  formatHotkeyBinding: () => '',
}));

function renderContextMenu(overrides: Partial<ComponentProps<typeof ItemContextMenu>> = {}) {
  const onDetectScenes = vi.fn();

  render(
    <ItemContextMenu
      trackLocked={false}
      isSelected
      canJoinSelected={false}
      hasJoinableLeft={false}
      hasJoinableRight={false}
      closerEdge={null}
      onJoinSelected={() => {}}
      onJoinLeft={() => {}}
      onJoinRight={() => {}}
      onRippleDelete={() => {}}
      onDelete={() => {}}
      canDetectScenes
      isDetectingScenes={false}
      onDetectScenes={onDetectScenes}
      {...overrides}
    >
      <div>Clip</div>
    </ItemContextMenu>
  );

  fireEvent.contextMenu(screen.getByText('Clip'));

  return { onDetectScenes };
}

describe('ItemContextMenu scene detection', () => {
  beforeEach(() => {
    mockGetSceneVerificationModelOptions.mockClear();
    useSelectionStore.setState({
      selectedItemIds: [],
      selectedMarkerId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
      selectedTrackIds: [],
      activeTrackId: null,
      selectionType: null,
    });
  });

  it('renders scene verification submenu labels from shared options', () => {
    renderContextMenu();

    expect(mockGetSceneVerificationModelOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Detect Scenes & Split')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fast (Histogram)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI (Gemma Turbo)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI (Liquid Vision)' })).toBeInTheDocument();
  });

  it('dispatches the selected verification model when a scene detection option is clicked', () => {
    const { onDetectScenes } = renderContextMenu();

    fireEvent.click(screen.getByRole('button', { name: 'AI (Liquid Vision)' }));

    expect(onDetectScenes).toHaveBeenCalledWith('optical-flow', 'lfm');
  });
});
