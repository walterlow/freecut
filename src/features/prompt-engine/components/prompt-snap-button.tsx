import { useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Loader2 } from 'lucide-react';
import { usePromptStore } from '../stores/prompt-store';

interface PromptSnapButtonProps {
  /** Called to capture current webcam frame and generate prompt via Scope. */
  onSnap?: () => Promise<string | null>;
  disabled?: boolean;
}

export const PromptSnapButton = memo(function PromptSnapButton({
  onSnap,
  disabled,
}: PromptSnapButtonProps) {
  const isGenerating = usePromptStore((s) => s.isGenerating);
  const setGenerating = usePromptStore((s) => s.setGenerating);
  const applyFromSnap = usePromptStore((s) => s.applyFromSnap);

  const handleSnap = useCallback(async () => {
    if (!onSnap || isGenerating) return;
    setGenerating(true);
    try {
      const prompt = await onSnap();
      if (prompt) {
        applyFromSnap(prompt);
      }
    } finally {
      setGenerating(false);
    }
  }, [onSnap, isGenerating, setGenerating, applyFromSnap]);

  return (
    <Button
      variant="default"
      size="sm"
      className="w-full"
      onClick={handleSnap}
      disabled={disabled || isGenerating}
    >
      {isGenerating ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          Analyzing...
        </>
      ) : (
        <>
          <Camera className="mr-1.5 h-3.5 w-3.5" />
          Snap Prompt
        </>
      )}
    </Button>
  );
});
