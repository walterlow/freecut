import { useCallback, memo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Send } from 'lucide-react';
import { usePromptStore } from '../stores/prompt-store';

interface MasterPromptBoxProps {
  onApplyPrompt?: (prompt: string) => void;
}

export const MasterPromptBox = memo(function MasterPromptBox({
  onApplyPrompt,
}: MasterPromptBoxProps) {
  const currentPrompt = usePromptStore((s) => s.currentPrompt);
  const setPrompt = usePromptStore((s) => s.setPrompt);
  const autoApply = usePromptStore((s) => s.autoApply);
  const setAutoApply = usePromptStore((s) => s.setAutoApply);
  const isGenerating = usePromptStore((s) => s.isGenerating);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPrompt(e.target.value);
    },
    [setPrompt],
  );

  const handleApply = useCallback(() => {
    if (currentPrompt.trim()) {
      onApplyPrompt?.(currentPrompt.trim());
    }
  }, [currentPrompt, onApplyPrompt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleApply();
      }
    },
    [handleApply],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">Master Prompt</Label>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="auto-apply" className="text-xs text-muted-foreground">
            Auto
          </Label>
          <Switch
            id="auto-apply"
            checked={autoApply}
            onCheckedChange={setAutoApply}
            className="scale-75"
          />
        </div>
      </div>
      <Textarea
        value={currentPrompt}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Describe your video scene... (Cmd+Enter to apply)"
        className="min-h-[80px] resize-y text-sm"
        disabled={isGenerating}
      />
      {!autoApply && (
        <Button
          size="sm"
          variant="secondary"
          onClick={handleApply}
          disabled={!currentPrompt.trim() || isGenerating}
          className="w-full"
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Apply Prompt
        </Button>
      )}
    </div>
  );
});
