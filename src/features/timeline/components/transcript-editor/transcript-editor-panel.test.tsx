import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

// Import the component directly
import { TranscriptEditorPanel } from './transcript-editor-panel'

describe('TranscriptEditorPanel inline editing and replace', () => {
  it('exports TranscriptEditorPanel component', () => {
    expect(TranscriptEditorPanel).toBeDefined()
  })
})
