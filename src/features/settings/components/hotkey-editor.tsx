import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, Download, Keyboard, RotateCcw, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/shared/ui/cn';
import {
  HOTKEYS,
  HOTKEY_DESCRIPTIONS,
  createHotkeyExportDocument,
  findHotkeyConflicts,
  formatHotkeyBinding,
  getBrowserHostileHotkey,
  getHotkeyBindingFromEventData,
  getHotkeyPrimaryTokenFromEventData,
  hasHotkeyPrimaryToken,
  normalizeHotkeyBinding,
  parseHotkeyImportDocument,
  splitHotkeyBinding,
  type HotkeyKey,
} from '@/config/hotkeys';
import {
  HOTKEY_EDITOR_SECTIONS,
  type HotkeyEditorItem,
  type HotkeyEditorSection,
} from './hotkey-editor-sections';
import { useResolvedHotkeys } from '../hooks/use-resolved-hotkeys';
import { useSettingsStore } from '../stores/settings-store';

interface KeyboardKeySpec {
  id: string;
  token?: string;
  label?: string;
  width?: number;
  isGap?: boolean;
}

interface KeyboardRowPair {
  main: readonly KeyboardKeySpec[];
  nav: readonly KeyboardKeySpec[];
}


// ---------------------------------------------------------------------------
// Full ANSI keyboard layout — main section + navigation/arrow cluster
// Each row pair aligns main keys (left) with nav/arrow keys (right).
// ---------------------------------------------------------------------------

const KEYBOARD_ROWS: readonly KeyboardRowPair[] = [
  {
    main: [
      { id: 'backquote', token: 'backquote' },
      { id: '1', token: '1' },
      { id: '2', token: '2' },
      { id: '3', token: '3' },
      { id: '4', token: '4' },
      { id: '5', token: '5' },
      { id: '6', token: '6' },
      { id: '7', token: '7' },
      { id: '8', token: '8' },
      { id: '9', token: '9' },
      { id: '0', token: '0' },
      { id: 'minus', token: 'minus' },
      { id: 'equals', token: 'equal' },
      { id: 'backspace', token: 'backspace', width: 2 },
    ],
    nav: [
      { id: 'insert', label: 'Ins' },
      { id: 'home', token: 'home' },
      { id: 'pageup', label: 'PgUp' },
    ],
  },
  {
    main: [
      { id: 'tab', token: 'tab', width: 1.5 },
      { id: 'q', token: 'q' },
      { id: 'w', token: 'w' },
      { id: 'e', token: 'e' },
      { id: 'r', token: 'r' },
      { id: 't', token: 't' },
      { id: 'y', token: 'y' },
      { id: 'u', token: 'u' },
      { id: 'i', token: 'i' },
      { id: 'o', token: 'o' },
      { id: 'p', token: 'p' },
      { id: 'bracketleft', token: 'bracketleft' },
      { id: 'bracketright', token: 'bracketright' },
      { id: 'backslash', token: 'backslash', width: 1.5 },
    ],
    nav: [
      { id: 'delete', token: 'delete' },
      { id: 'end', token: 'end' },
      { id: 'pagedown', label: 'PgDn' },
    ],
  },
  {
    main: [
      { id: 'caps', label: 'Caps', width: 1.8 },
      { id: 'a', token: 'a' },
      { id: 's', token: 's' },
      { id: 'd', token: 'd' },
      { id: 'f', token: 'f' },
      { id: 'g', token: 'g' },
      { id: 'h', token: 'h' },
      { id: 'j', token: 'j' },
      { id: 'k', token: 'k' },
      { id: 'l', token: 'l' },
      { id: 'semicolon', token: 'semicolon' },
      { id: 'quote', token: 'quote' },
      { id: 'enter', token: 'enter', width: 2.2 },
    ],
    nav: [],
  },
  {
    main: [
      { id: 'shift-left', token: 'shift', width: 2.3 },
      { id: 'z', token: 'z' },
      { id: 'x', token: 'x' },
      { id: 'c', token: 'c' },
      { id: 'v', token: 'v' },
      { id: 'b', token: 'b' },
      { id: 'n', token: 'n' },
      { id: 'm', token: 'm' },
      { id: 'comma', token: 'comma' },
      { id: 'period', token: 'period' },
      { id: 'slash', token: 'slash' },
      { id: 'shift-right', token: 'shift', width: 2.7 },
    ],
    nav: [
      { id: 'arrow-spacer-l', isGap: true },
      { id: 'up', token: 'up' },
      { id: 'arrow-spacer-r', isGap: true },
    ],
  },
  {
    main: [
      { id: 'mod-left', token: 'mod', width: 1.5 },
      { id: 'alt-left', token: 'alt', width: 1.3 },
      { id: 'space', token: 'space', width: 6.2 },
      { id: 'alt-right', token: 'alt', width: 1.3 },
      { id: 'mod-right', token: 'mod', width: 1.5 },
    ],
    nav: [
      { id: 'left', token: 'left' },
      { id: 'down', token: 'down' },
      { id: 'right', token: 'right' },
    ],
  },
];

const HOTKEY_ITEM_BY_KEY = Object.fromEntries(
  HOTKEY_EDITOR_SECTIONS.flatMap((section) =>
    section.items.flatMap((item) => item.keys.map((key) => [key, item]))
  )
) as Record<HotkeyKey, HotkeyEditorItem>;

function getSlotLabel(item: HotkeyEditorItem, key: HotkeyKey): string {
  if (item.keys.length === 1) {
    return 'Shortcut';
  }

  return item.keys[0] === key ? 'Primary shortcut' : 'Alternate shortcut';
}

function getBindingTokens(binding: string): string[] {
  return splitHotkeyBinding(binding);
}

function downloadJsonFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

async function readTextFile(file: File): Promise<string> {
  return file.text();
}

function HotkeyBindingPill({
  binding,
  isActive = false,
  isListening = false,
  isCustom = false,
  onClick,
}: {
  binding: string;
  isActive?: boolean;
  isListening?: boolean;
  isCustom?: boolean;
  onClick?: () => void;
}) {
  const tokens = getBindingTokens(binding);
  const content = tokens.length > 0 ? (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {tokens.map((token) => (
        <kbd
          key={`${binding}-${token}`}
          className={cn(
            'min-w-8 rounded-lg border px-2.5 py-1 text-[11px] font-mono tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-150 ease-out motion-reduce:transition-none',
            isActive
              ? 'border-primary/55 bg-primary/18 text-foreground'
              : 'border-white/8 bg-white/6 text-foreground/90',
            isListening && 'border-primary/60 bg-primary/20 text-primary'
          )}
        >
          {formatHotkeyBinding(token)}
        </kbd>
      ))}
      {isCustom ? (
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
          Custom
        </span>
      ) : null}
    </span>
  ) : (
    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
      Unassigned
    </span>
  );

  if (!onClick) {
    return <div>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl p-1 transition-colors duration-150 ease-out motion-reduce:transition-none',
        isActive ? 'bg-primary/10' : 'hover:bg-white/5'
      )}
    >
      {content}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Keyboard key cap — renders a single physical key or invisible gap spacer
// ---------------------------------------------------------------------------

const KEY_BASE_CLASSES =
  'flex h-[3.25rem] items-center justify-center rounded-lg border text-[11px] font-medium tracking-[0.06em] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.22)] transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none select-none';

const KEY_ACTIVE_CLASSES =
  'border-primary/55 bg-primary/18 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_20px_rgba(255,140,58,0.14)]';

const KEY_IDLE_CLASSES =
  'border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-foreground/78';

function KeyCap({
  keySpec,
  isActive,
  isLayerKey = false,
  tooltip,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  keySpec: KeyboardKeySpec;
  isActive: boolean;
  isLayerKey?: boolean;
  tooltip?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  if (keySpec.isGap) {
    return <div style={{ flex: keySpec.width ?? 1 }} />;
  }

  const label =
    keySpec.label ?? (keySpec.token ? formatHotkeyBinding(keySpec.token) : '');

  const keyCap = (
    <div
      className={cn(
        KEY_BASE_CLASSES,
        isActive
          ? KEY_ACTIVE_CLASSES
          : isLayerKey
            ? 'border-primary/25 bg-primary/8 text-foreground/85'
            : KEY_IDLE_CLASSES,
        keySpec.token && 'cursor-pointer hover:border-white/12 hover:text-foreground/92'
      )}
      style={{ flex: keySpec.width ?? 1 }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {label}
    </div>
  );

  if (!tooltip) {
    return keyCap;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{keyCap}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Full-width keyboard preview — ANSI layout with navigation + arrow cluster
// ---------------------------------------------------------------------------

function KeyboardPreview({
  activeBinding,
  layerTokens,
  hoverTokens,
  tokenLabels,
  onTokenHover,
  onTokenClick,
}: {
  activeBinding: string;
  layerTokens: ReadonlySet<string>;
  hoverTokens: ReadonlySet<string>;
  tokenLabels: ReadonlyMap<string, string>;
  onTokenHover: (token: string | null) => void;
  onTokenClick: (token: string) => void;
}) {
  const MODIFIER_TOKENS = new Set(['mod', 'alt', 'shift']);
  const activeTokens = new Set(
    getBindingTokens(activeBinding).filter((t) => !MODIFIER_TOKENS.has(t))
  );

  const renderRow = (keys: readonly KeyboardKeySpec[]) =>
    keys.map((keySpec) => (
      <KeyCap
        key={keySpec.id}
        keySpec={keySpec}
        isActive={keySpec.token ? (hoverTokens.size > 0 ? hoverTokens.has(keySpec.token) : activeTokens.has(keySpec.token)) : false}
        isLayerKey={keySpec.token ? layerTokens.has(keySpec.token) : false}
        tooltip={keySpec.token ? tokenLabels.get(keySpec.token) : undefined}
        onClick={keySpec.token ? () => onTokenClick(keySpec.token!) : undefined}
        onMouseEnter={keySpec.token ? () => onTokenHover(keySpec.token!) : undefined}
        onMouseLeave={() => onTokenHover(null)}
      />
    ));

  const renderRowPair = (pair: KeyboardRowPair, index: number) => (
    <div key={index} className="flex gap-3">
      {/* Main alphanumeric section */}
      <div className="flex min-w-0 flex-[15] gap-[5px]">
        {renderRow(pair.main)}
      </div>
      {/* Navigation / arrow cluster */}
      <div className="flex min-w-0 flex-[3] gap-[5px]">
        {pair.nav.length > 0 ? renderRow(pair.nav) : null}
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div className="mx-auto min-w-[900px] max-w-[1060px] space-y-[5px]">
        {KEYBOARD_ROWS.map((pair, i) => renderRowPair(pair, i))}
      </div>
    </div>
  );
}

export function HotkeyEditor() {
  const hotkeys = useResolvedHotkeys();
  const hotkeyOverrides = useSettingsStore((state) => state.hotkeyOverrides);
  const setHotkeyBinding = useSettingsStore((state) => state.setHotkeyBinding);
  const replaceHotkeyOverrides = useSettingsStore((state) => state.replaceHotkeyOverrides);
  const resetHotkeyBinding = useSettingsStore((state) => state.resetHotkeyBinding);
  const resetHotkeys = useSettingsStore((state) => state.resetHotkeys);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedKey, setSelectedKey] = useState<HotkeyKey>('PLAY_PAUSE');
  const [activeLayer, setActiveLayer] = useState<HotkeyEditorSection | null>(null);
  const [hoveredToken, setHoveredToken] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<HotkeyKey | null>(null);
  const [captureKey, setCaptureKey] = useState<HotkeyKey | null>(null);
  const [draftBinding, setDraftBinding] = useState('');
  const [previewBinding, setPreviewBinding] = useState('');

  const selectedItem = HOTKEY_ITEM_BY_KEY[selectedKey];
  const selectedSlotLabel = getSlotLabel(selectedItem, selectedKey);
  const isSelectedCustom = Boolean(hotkeyOverrides[selectedKey]);
  const customCount = Object.keys(hotkeyOverrides).length;
  const isCapturingSelectedKey = captureKey === selectedKey;
  const activePreviewBinding = isCapturingSelectedKey
    ? draftBinding || previewBinding || hotkeys[selectedKey]
    : hotkeys[selectedKey];
  const captureConflicts = captureKey && draftBinding
    ? findHotkeyConflicts(hotkeys, draftBinding, captureKey)
    : [];
  const isDraftChanged = Boolean(
    captureKey &&
    draftBinding &&
    normalizeHotkeyBinding(draftBinding) !== hotkeys[captureKey]
  );
  const canSaveCapture = Boolean(
    captureKey &&
    draftBinding &&
    hasHotkeyPrimaryToken(draftBinding) &&
    captureConflicts.length === 0 &&
    isDraftChanged
  );
  const selectedBrowserHotkey = getBrowserHostileHotkey(hotkeys[selectedKey]);
  const pendingBrowserHotkey = captureKey && draftBinding
    ? getBrowserHostileHotkey(draftBinding)
    : null;

  useEffect(() => {
    if (!captureKey) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCaptureKey(null);
        setDraftBinding('');
        setPreviewBinding('');
        return;
      }

      const nextBinding = getHotkeyBindingFromEventData(event);
      if (!nextBinding) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      setPreviewBinding(nextBinding);

      if (getHotkeyPrimaryTokenFromEventData(event)) {
        setDraftBinding(nextBinding);
      } else {
        setDraftBinding('');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [captureKey]);

  const startCapture = (key: HotkeyKey) => {
    setSelectedKey(key);
    setCaptureKey(key);
    setDraftBinding('');
    setPreviewBinding('');
  };

  const stopCapture = () => {
    setCaptureKey(null);
    setDraftBinding('');
    setPreviewBinding('');
  };

  const layerTokens = useMemo(() => {
    if (!activeLayer) return new Set<string>();
    const modifiers = new Set(['mod', 'alt', 'shift']);
    const tokens = new Set<string>();
    for (const item of activeLayer.items) {
      for (const key of item.keys) {
        for (const token of splitHotkeyBinding(hotkeys[key])) {
          if (!modifiers.has(token)) tokens.add(token);
        }
      }
    }
    return tokens;
  }, [activeLayer, hotkeys]);

  const tokenLabels = useMemo(() => {
    const map = new Map<string, string>();
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS;
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          for (const token of splitHotkeyBinding(hotkeys[key])) {
            if (token === 'mod' || token === 'alt' || token === 'shift') continue;
            const existing = map.get(token);
            if (existing) {
              if (!existing.includes(item.label)) {
                map.set(token, `${existing}, ${item.label}`);
              }
            } else {
              map.set(token, item.label);
            }
          }
        }
      }
    }
    return map;
  }, [activeLayer, hotkeys]);

  const hoverTokens = useMemo(() => {
    if (hoveredKey) {
      return new Set(splitHotkeyBinding(hotkeys[hoveredKey]));
    }
    if (!hoveredToken) return new Set<string>();
    const modifiers = new Set(['mod', 'alt', 'shift']);
    if (modifiers.has(hoveredToken)) return new Set<string>();
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS;
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          const tokens = splitHotkeyBinding(hotkeys[key]);
          const primary = tokens.filter((t) => !modifiers.has(t));
          if (primary.includes(hoveredToken)) return new Set(tokens);
        }
      }
    }
    return new Set<string>();
  }, [hoveredToken, hoveredKey, hotkeys, activeLayer]);

  const saveCapture = () => {
    if (!captureKey || !canSaveCapture) {
      return;
    }

    setHotkeyBinding(captureKey, normalizeHotkeyBinding(draftBinding));
    stopCapture();
  };

  const resetSelectedHotkey = () => {
    resetHotkeyBinding(selectedKey);
    stopCapture();
  };

  const handleTokenClick = (token: string) => {
    if (token === 'mod' || token === 'alt' || token === 'shift') return;
    stopCapture();
    setHoveredToken(null);
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS;
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          const tokens = splitHotkeyBinding(hotkeys[key]);
          const primary = tokens.filter((t) => t !== 'mod' && t !== 'alt' && t !== 'shift');
          if (primary.length === 1 && primary[0] === token) {
            setSelectedKey(key);
            return;
          }
        }
      }
    }
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          if (splitHotkeyBinding(hotkeys[key]).includes(token)) {
            setSelectedKey(key);
            return;
          }
        }
      }
    }
  };

  const exportHotkeys = () => {
    try {
      const exportDocument = createHotkeyExportDocument(hotkeyOverrides);
      const fileName = `freecut-hotkeys-${exportDocument.exportedAt.slice(0, 10)}.json`;
      downloadJsonFile(`${JSON.stringify(exportDocument, null, 2)}\n`, fileName);
      toast.success(`Downloaded ${fileName}`);
    } catch {
      toast.error('Failed to export keyboard shortcuts');
    }
  };

  const importHotkeys = async (file: File) => {
    try {
      const contents = await readTextFile(file);
      const importResult = parseHotkeyImportDocument(JSON.parse(contents));

      replaceHotkeyOverrides(importResult.overrides);
      stopCapture();

      const messages = [`Imported ${importResult.importedCommandCount} commands`];
      if (importResult.remappedCommandCount > 0) {
        messages.push(`remapped ${importResult.remappedCommandCount}`);
      }
      if (importResult.ignoredCommandCount > 0) {
        messages.push(`ignored ${importResult.ignoredCommandCount}`);
      }
      if (importResult.sourceVersion !== null) {
        messages.push(`preset v${importResult.sourceVersion}`);
      }

      toast.success(messages.join(' - '));
    } catch {
      toast.error('Failed to import keyboard shortcut preset');
    }
  };

  const handleImportButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    await importHotkeys(file);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(255,140,58,0.14),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0))]">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={handleImportFileChange}
      />

      {/* ── Header ── */}
      <div className="flex items-center gap-4 border-b border-white/6 px-5 py-2.5">
        <div className="flex flex-1 items-center gap-2.5">
          <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Keyboard Shortcuts</span>
          <span className="text-sm text-muted-foreground">&mdash; select a command, then record a new combo</span>
        </div>
        <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
          {customCount} custom
        </span>
        <DialogPrimitive.Close className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>

      {/* ── Full-width keyboard preview with section layers ── */}
      <div className="px-4 pb-3 md:px-5">
        <div className="flex min-h-[380px] overflow-hidden rounded-lg border border-white/7 bg-[#0d0d0f]/90">
          {/* Section layers sidebar */}
          <div className="flex shrink-0 flex-col gap-0.5 border-r border-white/6 p-2">
            <button
              type="button"
              onClick={() => { stopCapture(); setActiveLayer(null); }}
              className={cn(
                'rounded-lg px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.16em] transition-colors duration-150 ease-out motion-reduce:transition-none',
                activeLayer === null
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80'
              )}
            >
              All
            </button>
            <div className="my-1 border-t border-white/6" />
            {HOTKEY_EDITOR_SECTIONS.map((section) => (
              <button
                key={section.title}
                type="button"
                onClick={() => {
                  stopCapture();
                  setActiveLayer(section);
                  setSelectedKey(section.items[0]!.keys[0]!);
                }}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.16em] transition-colors duration-150 ease-out motion-reduce:transition-none',
                  activeLayer === section
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80'
                )}
              >
                {section.title}
              </button>
            ))}
          </div>
          {/* Keyboard */}
          <div className="flex min-w-0 flex-1 flex-col justify-center p-4 md:p-5">
            <KeyboardPreview
              activeBinding={activePreviewBinding}
              layerTokens={layerTokens}
              hoverTokens={hoverTokens}
              tokenLabels={tokenLabels}
              onTokenHover={setHoveredToken}
              onTokenClick={handleTokenClick}
            />
          </div>

          {/* Selected command panel — beside keyboard */}
          <div className="w-[280px] shrink-0 space-y-3 border-l border-white/6 p-4 pt-5">
            <div className="border-b border-white/6 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Selected Command
                  </div>
                  <div className="mt-1 text-base font-semibold tracking-tight text-foreground">
                    {selectedItem.label}
                  </div>
                </div>
                {isSelectedCustom ? (
                  <span className="mt-1 shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-primary">
                    Custom
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Current</div>
                <div className="mt-1 font-medium text-foreground">{formatHotkeyBinding(hotkeys[selectedKey])}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Default</div>
                <div className="mt-1 text-muted-foreground">{formatHotkeyBinding(HOTKEYS[selectedKey])}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {selectedSlotLabel}
              </div>
              <HotkeyBindingPill
                binding={activePreviewBinding}
                isActive
                isListening={isCapturingSelectedKey}
                isCustom={isSelectedCustom}
                onClick={() => startCapture(selectedKey)}
              />
            </div>

            {selectedBrowserHotkey ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs">
                <div className="flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Browser override
                </div>
                <p className="mt-1 leading-4 text-foreground/84">
                  {formatHotkeyBinding(selectedBrowserHotkey.binding)} may override {selectedBrowserHotkey.browserAction.toLowerCase()}.
                </p>
              </div>
            ) : null}

             <div className="grid grid-cols-2 gap-1.5">
               {isCapturingSelectedKey ? (
                 <>
                  <Button size="sm" className="w-full" onClick={saveCapture} disabled={!canSaveCapture}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={stopCapture}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" className="w-full" onClick={() => startCapture(selectedKey)}>
                    Record
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={resetSelectedHotkey}
                    disabled={!isSelectedCustom}
                  >
                    Reset
                  </Button>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleImportButtonClick}
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={exportHotkeys}
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>

            {isCapturingSelectedKey ? (
              <div className="rounded-lg border border-primary/20 bg-primary/8 p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-primary">Listening</div>
                <p className="mt-1 text-xs leading-4 text-foreground/88">
                  Hold modifiers, then press the final key. Escape to cancel.
                </p>
                {captureConflicts.length > 0 ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {captureConflicts.map((key) => HOTKEY_DESCRIPTIONS[key]).join(', ')}
                  </div>
                ) : null}
                {pendingBrowserHotkey ? (
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      This overrides {pendingBrowserHotkey.browserAction.toLowerCase()}.
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="text-[11px] leading-4 text-muted-foreground">
              Import or export a keybind preset.
            </p>

            <div className="border-t border-white/6 pt-3">
              <Button
                variant="destructive"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => { resetHotkeys(); stopCapture(); }}
                disabled={customCount === 0}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset All
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Command list — compact horizontal flow (scrollable) ── */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/8 px-4 py-2 md:px-5">
        <div className="columns-[240px] gap-x-2 gap-y-0">
          {(activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS).map((section) => (
            <div key={section.title} className="break-inside-avoid">
              {!activeLayer ? (
                <div className="mb-0.5 mt-1.5 first:mt-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {section.title}
                </div>
              ) : null}
              {section.items.map((item) => (
                <div
                  key={`${section.title}-${item.label}`}
                  className={cn(
                    'mb-1 break-inside-avoid rounded border px-2 py-1 text-left transition-colors duration-150 ease-out motion-reduce:transition-none',
                    hoveredToken || hoveredKey
                      ? (hoveredKey && item.keys.includes(hoveredKey)) || (hoveredToken && item.keys.some((k) => splitHotkeyBinding(hotkeys[k]).includes(hoveredToken)))
                        ? 'border-primary/35 bg-primary/10'
                        : 'border-white/7 bg-white/4'
                      : item.keys.includes(selectedKey)
                        ? 'border-primary/35 bg-primary/10'
                        : 'border-white/7 bg-white/4 hover:border-white/12 hover:bg-white/6'
                  )}
                  onMouseEnter={() => setHoveredKey(item.keys[0]!)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() => { stopCapture(); setSelectedKey(item.keys[0]!); }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-left text-[12px] leading-5 text-foreground/92 cursor-pointer">
                      {item.label}
                    </span>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {item.keys.map((key) => (
                        <HotkeyBindingPill
                          key={key}
                          binding={
                            captureKey === key
                              ? draftBinding || previewBinding || hotkeys[key]
                              : hotkeys[key]
                          }
                          isActive={selectedKey === key}
                          isListening={captureKey === key}
                          isCustom={Boolean(hotkeyOverrides[key])}
                          onClick={() => startCapture(key)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
