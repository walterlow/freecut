import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RotateCcw } from 'lucide-react';
import { useSettingsStore } from '@/features/settings/stores/settings-store';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Editor Settings</DialogTitle>
          <Button variant="ghost" size="sm" onClick={resetToDefaults} className="h-8 gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* General */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">General</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Auto-save</Label>
                  <Switch
                    checked={autoSaveInterval > 0}
                    onCheckedChange={(v) => setSetting('autoSaveInterval', v ? 5 : 0)}
                  />
                </div>
                {autoSaveInterval > 0 && (
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-muted-foreground">Interval</Label>
                    <div className="w-32 flex items-center gap-2">
                      <Slider
                        value={[autoSaveInterval]}
                        onValueChange={([v]) => setSetting('autoSaveInterval', v || 5)}
                        min={5}
                        max={30}
                        step={5}
                      />
                      <span className="text-xs text-muted-foreground w-6">{autoSaveInterval}m</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Timeline */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Timeline</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Show Waveforms</Label>
                  <Switch checked={showWaveforms} onCheckedChange={(v) => setSetting('showWaveforms', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Show Filmstrips</Label>
                  <Switch checked={showFilmstrips} onCheckedChange={(v) => setSetting('showFilmstrips', v)} />
                </div>
              </div>
            </section>

            {/* Performance */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Performance</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Undo History Depth</Label>
                  <div className="w-32 flex items-center gap-2">
                    <Slider
                      value={[maxUndoHistory]}
                      onValueChange={([v]) => setSetting('maxUndoHistory', v || 10)}
                      min={10}
                      max={200}
                      step={10}
                    />
                    <span className="text-xs text-muted-foreground w-6">{maxUndoHistory}</span>
                  </div>
                </div>
              </div>
            </section>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
