import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { FreeCutLogo } from '@/components/brand/freecut-logo';
import { useSettingsStore } from '@/features/settings/stores/settings-store';
import { HOTKEYS, HOTKEY_DESCRIPTIONS, type HotkeyKey } from '@/config/hotkeys';

export const Route = createFileRoute('/settings')({
  component: Settings,
});

function Settings() {
  const defaultFps = useSettingsStore((s) => s.defaultFps);
  const snapEnabled = useSettingsStore((s) => s.snapEnabled);
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const previewQuality = useSettingsStore((s) => s.previewQuality);
  const defaultExportFormat = useSettingsStore((s) => s.defaultExportFormat);
  const defaultExportQuality = useSettingsStore((s) => s.defaultExportQuality);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  // Format hotkey for display
  const formatHotkey = (hotkey: string): string => {
    return hotkey
      .replace('mod', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl')
      .replace('alt', navigator.platform.includes('Mac') ? 'Option' : 'Alt')
      .replace('shift', 'Shift')
      .split('+')
      .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
      .join(' + ');
  };

  // Important shortcuts to display
  const importantShortcuts: HotkeyKey[] = [
    'PLAY_PAUSE',
    'SPLIT_AT_PLAYHEAD',
    'DELETE_SELECTED',
    'UNDO',
    'REDO',
    'COPY',
    'CUT',
    'PASTE',
    'SAVE',
    'ZOOM_TO_FIT',
    'TOGGLE_SNAP',
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="panel-header border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/projects">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <FreeCutLogo variant="full" size="md" />
          </div>
          <Button variant="outline" onClick={resetToDefaults}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset to Defaults
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <h1 className="text-2xl font-bold">Settings</h1>

        {/* General Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">General</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-save Interval</Label>
                <p className="text-sm text-muted-foreground">
                  {autoSaveInterval === 0 ? 'Disabled' : `Every ${autoSaveInterval} minutes`}
                </p>
              </div>
              <div className="w-40 flex items-center gap-2">
                <Slider
                  value={[autoSaveInterval]}
                  onValueChange={([v]) => setSetting('autoSaveInterval', v ?? 0)}
                  onValueCommit={() => {
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }}
                  min={0}
                  max={30}
                  step={5}
                />
                <span className="text-sm text-muted-foreground w-8">{autoSaveInterval}m</span>
              </div>
            </div>
          </div>
        </section>

        {/* Timeline Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Timeline</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Default FPS</Label>
                <p className="text-sm text-muted-foreground">Frame rate for new projects</p>
              </div>
              <Select value={String(defaultFps)} onValueChange={(v) => setSetting('defaultFps', parseInt(v))}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 fps</SelectItem>
                  <SelectItem value="25">25 fps</SelectItem>
                  <SelectItem value="30">30 fps</SelectItem>
                  <SelectItem value="50">50 fps</SelectItem>
                  <SelectItem value="60">60 fps</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Snap to Grid</Label>
                <p className="text-sm text-muted-foreground">Snap clips to other clips and markers</p>
              </div>
              <Switch checked={snapEnabled} onCheckedChange={(v) => setSetting('snapEnabled', v)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Show Waveforms</Label>
                <p className="text-sm text-muted-foreground">Display audio waveforms on clips</p>
              </div>
              <Switch checked={showWaveforms} onCheckedChange={(v) => setSetting('showWaveforms', v)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Show Filmstrips</Label>
                <p className="text-sm text-muted-foreground">Display video thumbnails on clips</p>
              </div>
              <Switch checked={showFilmstrips} onCheckedChange={(v) => setSetting('showFilmstrips', v)} />
            </div>
          </div>
        </section>

        {/* Preview Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Preview</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Preview Quality</Label>
                <p className="text-sm text-muted-foreground">Lower quality improves performance</p>
              </div>
              <Select
                value={previewQuality}
                onValueChange={(v) => setSetting('previewQuality', v as 'low' | 'medium' | 'high')}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Export Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Export Defaults</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Default Format</Label>
                <p className="text-sm text-muted-foreground">Video format for exports</p>
              </div>
              <Select
                value={defaultExportFormat}
                onValueChange={(v) => setSetting('defaultExportFormat', v as 'mp4' | 'webm')}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4 (H.264)</SelectItem>
                  <SelectItem value="webm">WebM (VP9)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Default Quality</Label>
                <p className="text-sm text-muted-foreground">Video quality for exports</p>
              </div>
              <Select
                value={defaultExportQuality}
                onValueChange={(v) => setSetting('defaultExportQuality', v as 'low' | 'medium' | 'high' | 'ultra')}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="ultra">Ultra</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Keyboard Shortcuts Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Keyboard Shortcuts</h2>

          <div className="grid gap-2">
            {importantShortcuts.map((key) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm">{HOTKEY_DESCRIPTIONS[key]}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                  {formatHotkey(HOTKEYS[key])}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        {/* About Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">About</h2>

          <div className="grid gap-2 text-sm text-muted-foreground">
            <p>FreeCut - Open Source Video Editor</p>
            <p>
              Built with React and modern web technologies.{' '}
              <a
                href="https://github.com/walterlow/freecut"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                View on GitHub
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
