import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
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
import { LocalInferenceUnloadControl } from '@/features/settings/components/local-inference-unload-control';
import { useSettingsStore } from '@/features/settings/stores/settings-store';
import { HOTKEYS, HOTKEY_DESCRIPTIONS, type HotkeyKey } from '@/config/hotkeys';
import { EDITOR_DENSITY_OPTIONS } from '@/shared/ui/editor-layout';
import {
  getWhisperQuantizationOption,
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_MODEL_OPTIONS,
  WHISPER_QUANTIZATION_OPTIONS,
} from '@/shared/utils/whisper-settings';
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';

export const Route = createFileRoute('/settings')({
  component: Settings,
});

function Settings() {
  const defaultFps = useSettingsStore((s) => s.defaultFps);
  const snapEnabled = useSettingsStore((s) => s.snapEnabled);
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const defaultExportFormat = useSettingsStore((s) => s.defaultExportFormat);
  const defaultExportQuality = useSettingsStore((s) => s.defaultExportQuality);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const defaultWhisperModel = useSettingsStore((s) => s.defaultWhisperModel);
  const defaultWhisperQuantization = useSettingsStore((s) => s.defaultWhisperQuantization);
  const defaultWhisperLanguage = useSettingsStore((s) => s.defaultWhisperLanguage);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const defaultWhisperLanguageValue = getWhisperLanguageSelectValue(defaultWhisperLanguage);
  const defaultWhisperQuantizationOption = getWhisperQuantizationOption(defaultWhisperQuantization);

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

        {/* Interface Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Interface</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Editor Density</Label>
                <p className="text-sm text-muted-foreground">
                  Compact shows more of the editor at once. Default restores the roomier shell.
                </p>
              </div>
              <Select
                value={editorDensity}
                onValueChange={(value) => setSetting('editorDensity', value as typeof editorDensity)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITOR_DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

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

        {/* Whisper Section */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b border-border pb-2">Whisper Defaults</h2>

          <div className="grid gap-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Default Model</Label>
                <p className="text-sm text-muted-foreground">Used when a transcription flow does not explicitly choose a model</p>
              </div>
              <Select
                value={defaultWhisperModel}
                onValueChange={(value) => setSetting('defaultWhisperModel', value as MediaTranscriptModel)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHISPER_MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Default Quantization</Label>
                <p className="text-sm text-muted-foreground">
                  Pick based on memory first. {defaultWhisperQuantizationOption.description}
                </p>
              </div>
              <Select
                value={defaultWhisperQuantization}
                onValueChange={(value) =>
                  setSetting('defaultWhisperQuantization', value as MediaTranscriptQuantization)
                }
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHISPER_QUANTIZATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label>Default Language</Label>
                <p className="text-sm text-muted-foreground">Choose Auto-detect or lock transcription to a known language</p>
              </div>
              <Combobox
                value={defaultWhisperLanguageValue}
                onValueChange={(value) =>
                  setSetting('defaultWhisperLanguage', getWhisperLanguageSettingValue(value))
                }
                options={WHISPER_LANGUAGE_OPTIONS}
                className="w-48"
                placeholder="Auto-detect"
                searchPlaceholder="Search languages..."
                emptyMessage="No languages match that search."
              />
            </div>

            <LocalInferenceUnloadControl
              buttonClassName="h-9 w-32 gap-2"
              descriptionClassName="text-sm"
            />
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
