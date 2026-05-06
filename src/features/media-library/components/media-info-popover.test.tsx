import type { ReactNode, MouseEvent } from 'react'
import { createContext, cloneElement, isValidElement, useContext } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test'
import type { MediaMetadata, MediaTranscript } from '@/types/storage'

const mediaTranscriptionServiceMocks = vi.hoisted(() => ({
  getTranscript: vi.fn(),
}))

vi.mock('@/components/ui/popover', () => {
  const PopoverContext = createContext<{
    open: boolean
    onOpenChange: (open: boolean) => void
  }>({
    open: false,
    onOpenChange: () => {},
  })

  return {
    Popover: ({
      children,
      open = false,
      onOpenChange = () => {},
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => (
      <PopoverContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </PopoverContext.Provider>
    ),
    PopoverTrigger: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
      const { open, onOpenChange } = useContext(PopoverContext)
      if (asChild && isValidElement(children)) {
        const child = children as React.ReactElement<{
          onClick?: (event: MouseEvent<HTMLButtonElement>) => void
        }>
        return cloneElement(child, {
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            child.props.onClick?.(event)
            onOpenChange(!open)
          },
        })
      }
      return <button onClick={() => onOpenChange(!open)}>{children}</button>
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = useContext(PopoverContext)
      return open ? <div>{children}</div> : null
    },
  }
})

vi.mock('../services/media-transcription-service', () => ({
  mediaTranscriptionService: mediaTranscriptionServiceMocks,
}))

vi.mock('../transcription/registry', () => ({
  getMediaTranscriptionModelLabel: (model: string) => (model === 'whisper-tiny' ? 'Tiny' : model),
}))

import { MediaInfoPopover } from './media-info-popover'

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('MediaInfoPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads and displays transcript details when opened', async () => {
    const transcript: MediaTranscript = {
      id: 'media-1',
      mediaId: 'media-1',
      model: 'whisper-tiny',
      quantization: 'q8',
      text: 'Hello world from transcript',
      segments: [{ text: 'Hello world', start: 1.25, end: 2.5 }],
      createdAt: 1,
      updatedAt: 1,
    }
    mediaTranscriptionServiceMocks.getTranscript.mockResolvedValue(transcript)
    const onSeekToCaption = vi.fn()

    render(<MediaInfoPopover media={makeMedia()} onSeekToCaption={onSeekToCaption} />)

    fireEvent.click(screen.getByTitle('Media info'))

    await waitFor(() => {
      expect(mediaTranscriptionServiceMocks.getTranscript).toHaveBeenCalledWith('media-1')
    })

    expect(await screen.findByText('Transcript (1)')).toBeInTheDocument()
    expect(screen.getByText('Tiny')).toBeInTheDocument()
    expect(screen.getByText('Hello world from transcript')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '0:01' }))
    expect(onSeekToCaption).toHaveBeenCalledWith(1.25)
  })
})
