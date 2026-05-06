import { describe, it, expect } from 'vite-plus/test'
import {
  computeGridDimensions,
  computeBentoLayout,
  computeLayout,
  type BentoLayoutItem,
} from './bento-layout'

describe('computeGridDimensions', () => {
  it('returns 0x0 for count 0', () => {
    expect(computeGridDimensions(0)).toEqual({ cols: 0, rows: 0 })
  })

  it('returns correct dimensions for 1..12', () => {
    const expected: Record<number, { cols: number; rows: number }> = {
      1: { cols: 1, rows: 1 },
      2: { cols: 2, rows: 1 },
      3: { cols: 2, rows: 2 },
      4: { cols: 2, rows: 2 },
      5: { cols: 3, rows: 2 },
      6: { cols: 3, rows: 2 },
      7: { cols: 3, rows: 3 },
      8: { cols: 3, rows: 3 },
      9: { cols: 3, rows: 3 },
      10: { cols: 4, rows: 3 },
      11: { cols: 4, rows: 3 },
      12: { cols: 4, rows: 3 },
    }

    for (const [count, dims] of Object.entries(expected)) {
      expect(computeGridDimensions(Number(count)), `count=${count}`).toEqual(dims)
    }
  })
})

describe('computeBentoLayout', () => {
  const canvas = { width: 1280, height: 720 }

  it('returns empty map for empty input', () => {
    const result = computeBentoLayout([], canvas.width, canvas.height)
    expect(result.size).toBe(0)
  })

  it('single item returns centered fit', () => {
    const items: BentoLayoutItem[] = [{ id: 'a', sourceWidth: 1920, sourceHeight: 1080 }]
    const result = computeBentoLayout(items, canvas.width, canvas.height, { gap: 0, padding: 0 })
    const t = result.get('a')!

    // Should be centered (x=0, y=0)
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
    // 1920x1080 fit into 1280x720 → scale = min(1280/1920, 720/1080) = 2/3
    expect(t.width).toBe(1280)
    expect(t.height).toBe(720)
    expect(t.rotation).toBe(0)
  })

  it('2x2 grid with correct center-relative coordinates', () => {
    const items: BentoLayoutItem[] = [
      { id: 'a', sourceWidth: 1920, sourceHeight: 1080 },
      { id: 'b', sourceWidth: 1920, sourceHeight: 1080 },
      { id: 'c', sourceWidth: 1920, sourceHeight: 1080 },
      { id: 'd', sourceWidth: 1920, sourceHeight: 1080 },
    ]
    const result = computeBentoLayout(items, canvas.width, canvas.height, { gap: 0, padding: 0 })

    // 2 cols, 2 rows. Cell size: 640x360
    // Canvas center: 640, 360
    // Cell centers: (320, 180), (960, 180), (320, 540), (960, 540)
    const a = result.get('a')!
    const b = result.get('b')!
    const c = result.get('c')!
    const d = result.get('d')!

    expect(a.x).toBe(320 - 640) // -320
    expect(a.y).toBe(180 - 360) // -180
    expect(b.x).toBe(960 - 640) // 320
    expect(b.y).toBe(180 - 360) // -180
    expect(c.x).toBe(320 - 640) // -320
    expect(c.y).toBe(540 - 360) // 180
    expect(d.x).toBe(960 - 640) // 320
    expect(d.y).toBe(540 - 360) // 180
  })

  it('preserves aspect ratio (fit-contain within cells)', () => {
    // Tall source in a wider cell
    const items: BentoLayoutItem[] = [{ id: 'tall', sourceWidth: 400, sourceHeight: 800 }]
    const result = computeBentoLayout(items, 1280, 720, { gap: 0, padding: 0 })
    const t = result.get('tall')!

    // Cell is 1280x720. Source 400x800 → scaleX=3.2, scaleY=0.9, fitScale=0.9
    // fitWidth=360, fitHeight=720
    expect(t.width).toBe(360)
    expect(t.height).toBe(720)
    // Centered
    expect(t.x).toBe(0)
    expect(t.y).toBe(0)
  })

  it('gap reduces cell size', () => {
    const items: BentoLayoutItem[] = [
      { id: 'a', sourceWidth: 1920, sourceHeight: 1080 },
      { id: 'b', sourceWidth: 1920, sourceHeight: 1080 },
    ]
    // 2 items → 2 cols, 1 row. Gap=20.
    // Available: 1280. Cells: (1280-20)/2 = 630 wide, 720 tall
    const result = computeBentoLayout(items, canvas.width, canvas.height, { gap: 20, padding: 0 })
    const a = result.get('a')!
    const b = result.get('b')!

    // 1920x1080 fit into 630x720 → scaleX=630/1920≈0.328, scaleY=720/1080≈0.667 → fitScale=0.328
    // fitWidth=round(1920*0.328)=630, fitHeight=round(1080*0.328)=354
    expect(a.width).toBe(630)
    expect(a.height).toBe(354)
    // Verify items are offset from each other
    expect(b.x!).toBeGreaterThan(a.x!)
  })

  it('padding reduces available area', () => {
    const items: BentoLayoutItem[] = [{ id: 'a', sourceWidth: 1280, sourceHeight: 720 }]
    const result = computeBentoLayout(items, 1280, 720, { gap: 0, padding: 40 })
    const t = result.get('a')!

    // Available: 1200x640. Source 1280x720 fit → scale=min(1200/1280, 640/720)=min(0.9375, 0.889)=0.889
    // fitWidth=round(1280*0.889)=1138, fitHeight=round(720*0.889)=640
    expect(t.width).toBe(1138)
    expect(t.height).toBe(640)
  })

  it('rotation is always reset to 0', () => {
    const items: BentoLayoutItem[] = [
      { id: 'a', sourceWidth: 100, sourceHeight: 100 },
      { id: 'b', sourceWidth: 200, sourceHeight: 100 },
    ]
    const result = computeBentoLayout(items, 1280, 720)
    for (const t of result.values()) {
      expect(t.rotation).toBe(0)
    }
  })
})

describe('computeLayout', () => {
  const canvas = { width: 1280, height: 720 }

  const makeItems = (count: number): BentoLayoutItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: String.fromCharCode(97 + i), // a, b, c, ...
      sourceWidth: 1920,
      sourceHeight: 1080,
    }))

  describe('row preset', () => {
    it('places 3 items in a single row', () => {
      const items = makeItems(3)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'row',
        gap: 0,
        padding: 0,
      })

      expect(result.size).toBe(3)

      const a = result.get('a')!
      const b = result.get('b')!
      const c = result.get('c')!

      // All should have the same y (single row)
      expect(a.y).toBe(b.y)
      expect(b.y).toBe(c.y)

      // x should increase left to right
      expect(b.x!).toBeGreaterThan(a.x!)
      expect(c.x!).toBeGreaterThan(b.x!)
    })
  })

  describe('column preset', () => {
    it('places 3 items in a single column', () => {
      const items = makeItems(3)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'column',
        gap: 0,
        padding: 0,
      })

      expect(result.size).toBe(3)

      const a = result.get('a')!
      const b = result.get('b')!
      const c = result.get('c')!

      // All should have the same x (single column)
      expect(a.x).toBe(b.x)
      expect(b.x).toBe(c.x)

      // y should increase top to bottom
      expect(b.y!).toBeGreaterThan(a.y!)
      expect(c.y!).toBeGreaterThan(b.y!)
    })
  })

  describe('pip preset', () => {
    it('first item fills canvas, second item small in corner', () => {
      const items = makeItems(2)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'pip',
        gap: 8,
        padding: 0,
      })

      expect(result.size).toBe(2)

      const main = result.get('a')!
      const pip = result.get('b')!

      // Main item should be centered and large
      expect(main.x).toBe(0)
      expect(main.y).toBe(0)
      expect(main.width).toBe(1280)
      expect(main.height).toBe(720)

      // Pip item should be much smaller
      expect(pip.width!).toBeLessThan(main.width! / 2)
      expect(pip.height!).toBeLessThan(main.height! / 2)

      // Pip should be in bottom-right area (positive x and y)
      expect(pip.x!).toBeGreaterThan(0)
      expect(pip.y!).toBeGreaterThan(0)
    })

    it('handles single item gracefully', () => {
      const items = makeItems(1)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'pip',
        gap: 0,
        padding: 0,
      })

      expect(result.size).toBe(1)
      const main = result.get('a')!
      expect(main.x).toBe(0)
      expect(main.y).toBe(0)
    })
  })

  describe('focus-sidebar preset', () => {
    it('first item wide, rest narrow on right', () => {
      const items = makeItems(3)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'focus-sidebar',
        gap: 8,
        padding: 0,
      })

      expect(result.size).toBe(3)

      const focus = result.get('a')!
      const side1 = result.get('b')!
      const side2 = result.get('c')!

      // Focus item should be on the left (negative x or near center-left)
      expect(focus.x!).toBeLessThan(side1.x!)

      // Focus item should be wider than sidebar items
      expect(focus.width!).toBeGreaterThan(side1.width!)
      expect(focus.width!).toBeGreaterThan(side2.width!)

      // Sidebar items should have same x (stacked vertically)
      expect(side1.x).toBe(side2.x)

      // Sidebar items stacked vertically
      expect(side2.y!).toBeGreaterThan(side1.y!)
    })

    it('handles single item gracefully', () => {
      const items = makeItems(1)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'focus-sidebar',
        gap: 8,
        padding: 0,
      })

      expect(result.size).toBe(1)
    })
  })

  describe('grid preset', () => {
    it('uses custom 3x2 grid regardless of item count', () => {
      const items = makeItems(4)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'grid',
        cols: 3,
        rows: 2,
        gap: 0,
        padding: 0,
      })

      expect(result.size).toBe(4)

      const a = result.get('a')!
      const b = result.get('b')!
      const c = result.get('c')!
      const d = result.get('d')!

      // First 3 items in row 0, 4th item in row 1
      // Row 0: a, b, c should have same y
      expect(a.y).toBe(b.y)
      expect(b.y).toBe(c.y)

      // d should be in row 1 (different y)
      expect(d.y!).toBeGreaterThan(a.y!)
    })

    it('gracefully handles more slots than items (empty slots)', () => {
      const items = makeItems(2)
      const result = computeLayout(items, canvas.width, canvas.height, {
        preset: 'grid',
        cols: 3,
        rows: 3,
        gap: 0,
        padding: 0,
      })

      // Only 2 items placed, 7 slots empty — no crash
      expect(result.size).toBe(2)
    })
  })

  describe('auto preset via computeLayout', () => {
    it('matches computeBentoLayout behavior', () => {
      const items = makeItems(4)
      const autoResult = computeLayout(items, canvas.width, canvas.height, {
        preset: 'auto',
        gap: 0,
        padding: 0,
      })
      const bentoResult = computeBentoLayout(items, canvas.width, canvas.height, {
        gap: 0,
        padding: 0,
      })

      expect(autoResult.size).toBe(bentoResult.size)
      for (const [id, t] of autoResult) {
        const bt = bentoResult.get(id)!
        expect(t.x).toBe(bt.x)
        expect(t.y).toBe(bt.y)
        expect(t.width).toBe(bt.width)
        expect(t.height).toBe(bt.height)
      }
    })
  })
})
