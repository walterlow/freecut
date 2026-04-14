import { memo, useState, useCallback } from 'react';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSettingsStore } from '@/features/generative/deps/settings';

export const ApiKeyInput = memo(function ApiKeyInput() {
  const apiKey = useSettingsStore((s) => s.evolinkApiKey);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [draft, setDraft] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleSave = useCallback(() => {
    if (draft.trim()) {
      setSetting('evolinkApiKey', draft.trim());
      setDraft('');
    }
  }, [draft, setSetting]);

  if (apiKey) return null;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-6">
      <KeyRound className="h-8 w-8 text-muted-foreground" />
      <div className="text-center">
        <p className="text-sm font-medium">API Key Required</p>
        <p className="text-xs text-muted-foreground">
          Enter your evolink.ai API key to enable AI video and image generation.
        </p>
      </div>
      <div className="flex w-full max-w-sm gap-2">
        <div className="relative flex-1">
          <Input
            type={showKey ? 'text' : 'password'}
            placeholder="Bearer token..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            className="pr-8 text-xs"
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!draft.trim()}>
          Save
        </Button>
      </div>
    </div>
  );
});
