import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { TiledCanvas } from './tiled-canvas'

describe('TiledCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes whole-pixel widths to tile renderers when the final tile is fractional', async () => {
    const ctx = {
      scale: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    ;(
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
        mockReturnValue: (value: CanvasRenderingContext2D) => void
      }
    ).mockReturnValue(ctx)

    const renderTile = vi.fn()

    render(<TiledCanvas width={1000.5} height={24} renderTile={renderTile} version={1} />)

    await waitFor(() => {
      expect(renderTile).toHaveBeenCalledTimes(2)
    })

    expect(renderTile).toHaveBeenNthCalledWith(1, ctx, 0, 0, 1000)
    expect(renderTile).toHaveBeenNthCalledWith(2, ctx, 1, 1000, 1)
  })

  it('only creates tiles inside the visible window plus overscan', async () => {
    const ctx = {
      scale: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    ;(
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext') as unknown as {
        mockReturnValue: (value: CanvasRenderingContext2D) => void
      }
    ).mockReturnValue(ctx)

    const renderTile = vi.fn()

    render(
      <TiledCanvas
        width={6000}
        height={24}
        renderTile={renderTile}
        version={1}
        visibleStartPx={2100}
        visibleEndPx={3900}
        overscanTiles={1}
      />,
    )

    await waitFor(() => {
      expect(renderTile).toHaveBeenCalledTimes(4)
    })

    expect(renderTile).toHaveBeenNthCalledWith(1, ctx, 1, 1000, 1000)
    expect(renderTile).toHaveBeenNthCalledWith(2, ctx, 2, 2000, 1000)
    expect(renderTile).toHaveBeenNthCalledWith(3, ctx, 3, 3000, 1000)
    expect(renderTile).toHaveBeenNthCalledWith(4, ctx, 4, 4000, 1000)
  })
})
