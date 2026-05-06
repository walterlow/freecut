import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Volume2, VolumeX } from 'lucide-react'

interface UnsupportedCodecFile {
  fileName: string
  audioCodec: string
}

interface UnsupportedAudioCodecDialogProps {
  open: boolean
  files: UnsupportedCodecFile[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Dialog shown when importing media files with unsupported audio codecs.
 * Informs the user that waveform visualization won't be available for these files.
 */
export function UnsupportedAudioCodecDialog({
  open,
  files,
  onConfirm,
  onCancel,
}: UnsupportedAudioCodecDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent className="sm:max-w-[500px] overflow-hidden">
        <AlertDialogHeader className="overflow-hidden">
          <AlertDialogTitle className="flex items-center gap-2">
            <VolumeX className="w-5 h-5 text-yellow-500 shrink-0" />
            Unsupported Audio Codec
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                {files.length === 1 ? 'This file uses' : `${files.length} files use`} an audio codec
                that cannot be decoded in the browser. Audio waveform visualization will not be
                available.
              </p>

              <div className="max-h-[200px] overflow-y-auto overflow-x-hidden space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-2 p-2 bg-secondary/50 rounded text-sm"
                  >
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                    <span className="truncate" title={file.fileName}>
                      {file.fileName}
                    </span>
                    <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-secondary rounded uppercase whitespace-nowrap">
                      {file.audioCodec}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Video playback and editing will work normally. Only audio waveform display is
                affected.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel Import</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Import Anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
