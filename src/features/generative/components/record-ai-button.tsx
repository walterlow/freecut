import { useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Circle, Square } from 'lucide-react';
import { useLiveSessionStore } from '../deps/live-ai';

/**
 * "Record AI Video" button positioned above the timeline.
 * When engaged, stamps the AI output from the Generative Bridge onto the timeline
 * at the playhead, simultaneously laying down synced audio.
 */
export const RecordAiButton = memo(function RecordAiButton() {
  const isRecording = useLiveSessionStore((s) => s.isRecording);
  const setRecording = useLiveSessionStore((s) => s.setRecording);
  const streamActive = useLiveSessionStore((s) => s.streamActive);

  const handleToggle = useCallback(() => {
    setRecording(!isRecording);
  }, [isRecording, setRecording]);

  return (
    <Button
      variant={isRecording ? 'destructive' : 'secondary'}
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={handleToggle}
      disabled={!streamActive}
      data-tooltip={isRecording ? 'Stop Recording' : 'Record AI Video'}
      data-tooltip-side="top"
    >
      {isRecording ? (
        <>
          <Square className="h-3 w-3 fill-current" />
          Stop
        </>
      ) : (
        <>
          <Circle className="h-3 w-3 fill-red-500 text-red-500" />
          Record AI Video
        </>
      )}
    </Button>
  );
});
