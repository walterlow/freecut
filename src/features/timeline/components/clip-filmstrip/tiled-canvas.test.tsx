import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TiledCanvas } from './tiled-canvas';

describe('TiledCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes whole-pixel widths to tile renderers when the final tile is fractional', async () => {
    const ctx = {
      scale: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);

    const renderTile = vi.fn();

    render(
      <TiledCanvas
        width={1000.5}
        height={24}
        renderTile={renderTile}
        version={1}
      />,
    );

    await waitFor(() => {
      expect(renderTile).toHaveBeenCalledTimes(2);
    });

    expect(renderTile).toHaveBeenNthCalledWith(1, ctx, 0, 0, 1000);
    expect(renderTile).toHaveBeenNthCalledWith(2, ctx, 1, 1000, 1);
  });
});
