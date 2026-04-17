import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge';
import { TimecodeDisplay } from './timecode-display';

function resetPlaybackStore() {
  localStorage.clear();

  usePlaybackStore.setState({
    currentFrame: 12,
    currentFrameEpoch: 0,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    useProxy: true,
    previewQuality: 1,
  });
  usePreviewBridgeStore.setState({
    displayedFrame: null,
    captureFrame: null,
    captureFrameImageData: null,
    captureCanvasSource: null,
  });
}

describe('TimecodeDisplay', () => {
  beforeEach(() => {
    resetPlaybackStore();
  });

  it('keeps the same reserved width when toggling between SMPTE and frames', () => {
    render(<TimecodeDisplay fps={30} totalFrames={1000} />);

    const button = screen.getByRole('button');
    const [currentTime, , totalTime] = button.querySelectorAll('span');

    expect(button).toHaveStyle({ width: 'calc(17ch + 0.75rem)' });
    expect(button).toHaveTextContent('00:00:12');
    expect(button).toHaveTextContent('00:33:09');

    fireEvent.click(button);

    expect(button).toHaveStyle({ width: 'calc(17ch + 0.75rem)' });
    expect(currentTime).not.toHaveStyle({ width: '11ch' });
    expect(totalTime).not.toHaveStyle({ width: '11ch' });
    expect(button).toHaveTextContent('0012');
    expect(button).toHaveTextContent('0999');
  });

  it('shows the skim preview frame in the timecode readout', () => {
    render(<TimecodeDisplay fps={30} totalFrames={1000} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('00:00:12');

    usePlaybackStore.getState().setPreviewFrame(48);

    expect(button).toHaveTextContent('00:01:18');
  });

  it('prefers the displayed overlay frame when fast scrub owns presentation', () => {
    render(<TimecodeDisplay fps={30} totalFrames={1000} />);

    const button = screen.getByRole('button');
    usePlaybackStore.setState({
      currentFrame: 12,
      currentFrameEpoch: 1,
      previewFrame: 48,
      previewFrameEpoch: 2,
    });
    usePreviewBridgeStore.getState().setDisplayedFrame(50);

    expect(button).toHaveTextContent('00:01:20');
  });
});
