import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import { CAPTION_STYLE_PRESETS } from '@/shared/typography/caption-style-presets'
import type { TextItem } from '@/types/timeline'

import { CaptionStyleControls } from './caption-style-controls'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'editor.captionStyleControls.stylePreset': 'Style preset',
        'editor.captionStyleControls.background': 'Background',
        'editor.captionStyleControls.on': 'On',
        'editor.captionStyleControls.off': 'Off',
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('../components', () => ({
  ColorPicker: () => null,
  PropertyRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SliderInput: () => null,
}))

const netflixPreset = CAPTION_STYLE_PRESETS.find((preset) => preset.id === 'netflix')
if (!netflixPreset) throw new Error('Netflix caption preset is required by this test')

const netflixCaption: TextItem = {
  id: 'caption-1',
  trackId: 'track-1',
  type: 'text',
  label: 'Caption',
  text: 'Hello',
  from: 0,
  durationInFrames: 30,
  ...netflixPreset.patch,
}

describe('CaptionStyleControls selected styling', () => {
  it('uses neutral selected styling for the active preset and enabled background', () => {
    render(<CaptionStyleControls items={[netflixCaption]} canvasWidth={1920} canvasHeight={1080} />)

    for (const control of [
      screen.getByRole('button', { name: 'Netflix' }),
      screen.getByRole('button', { name: 'On' }),
    ]) {
      expect(control).toHaveClass('border-border/70', 'bg-secondary/60', 'text-foreground')
      expect(control).not.toHaveClass('border-primary', 'bg-primary/15')
    }
  })
})
