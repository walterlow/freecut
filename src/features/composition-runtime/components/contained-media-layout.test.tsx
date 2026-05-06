import { render } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { ContainedMediaLayout } from './contained-media-layout'

describe('ContainedMediaLayout', () => {
  it('positions the contained media rect using percentages', () => {
    const { container } = render(
      <ContainedMediaLayout
        sourceWidth={1920}
        sourceHeight={1080}
        containerWidth={400}
        containerHeight={400}
        crop={{ left: 0.1, top: 0.2 }}
      >
        <div data-testid="media" />
      </ContainedMediaLayout>,
    )

    const wrappers = container.querySelectorAll('div')
    // Structure: outer > mediaRect > children
    const mediaRect = wrappers[1] as HTMLDivElement | undefined

    expect(mediaRect?.style.top).toBe('21.875%')
    expect(mediaRect?.style.height).toBe('56.25%')
    // Crop mask is applied directly on the mediaRect via mask-image
    const style = mediaRect?.getAttribute('style') ?? ''
    expect(style).toContain('mask-image')
  })

  it('applies a composite mask when crop softness is active', () => {
    const { container } = render(
      <ContainedMediaLayout
        sourceWidth={1920}
        sourceHeight={1080}
        containerWidth={400}
        containerHeight={400}
        crop={{ left: 0.1, softness: 0.1 }}
      >
        <div data-testid="media" />
      </ContainedMediaLayout>,
    )

    const wrappers = container.querySelectorAll('div')
    const mediaRect = wrappers[1] as HTMLDivElement | undefined
    const style = mediaRect?.getAttribute('style') ?? ''
    // Should have a gradient mask for the left crop with feather
    expect(style).toContain('linear-gradient')
    expect(style).toContain('mask-image')
  })

  it('renders without mask when no crop is set', () => {
    const { container } = render(
      <ContainedMediaLayout
        sourceWidth={1920}
        sourceHeight={1080}
        containerWidth={400}
        containerHeight={400}
      >
        <div data-testid="media" />
      </ContainedMediaLayout>,
    )

    const wrappers = container.querySelectorAll('div')
    const mediaRect = wrappers[1] as HTMLDivElement | undefined
    const style = mediaRect?.getAttribute('style') ?? ''
    expect(style).not.toContain('mask-image')
  })
})
