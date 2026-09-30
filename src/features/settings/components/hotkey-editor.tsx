import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/shared/hooks/use-prefers-reduced-motion'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { AlertTriangle, Download, Keyboard, Plus, RotateCcw, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/shared/ui/cn'
import {
  HOTKEYS,
  createHotkeyExportDocument,
  findHotkeyConflicts,
  formatHotkeyBinding,
  getBrowserHostileHotkey,
  getHotkeyBindingFromEventData,
  getHotkeyPrimaryTokenFromEventData,
  hasHotkeyPrimaryToken,
  normalizeHotkeyBinding,
  parseHotkeyImportDocument,
  resolveHotkeys,
  splitHotkeyBinding,
  type HotkeyBindingMap,
  type HotkeyImportResult,
  type HotkeyKey,
  type HotkeyOverrideMap,
} from '@/config/hotkeys'
import {
  HOTKEY_EDITOR_SECTIONS,
  getHotkeyBindingDisplayLabel,
  getHotkeyEditorSearchResults,
  type HotkeyEditorItem,
  type HotkeyEditorSearchResult,
  type HotkeyEditorSection,
} from './hotkey-editor-sections'
import { useNaturalHeight } from '@/shared/ui/use-natural-height'
import { useKeyboardLayoutLabels } from '../hooks/use-keyboard-layout'
import { useResolvedHotkeys } from '../hooks/use-resolved-hotkeys'
import { useSettingsStore } from '../stores/settings-store'

interface KeyboardKeySpec {
  id: string
  token?: string
  label?: string
  width?: number
  isGap?: boolean
}

interface KeyboardRowPair {
  main: readonly KeyboardKeySpec[]
  nav: readonly KeyboardKeySpec[]
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
]

const HOTKEY_ITEM_BY_KEY = Object.fromEntries(
  HOTKEY_EDITOR_SECTIONS.flatMap((section) =>
    section.items.flatMap((item) => item.keys.map((key) => [key, item])),
  ),
) as Record<HotkeyKey, HotkeyEditorItem>

function getSlotLabelKey(item: HotkeyEditorItem, key: HotkeyKey): string {
  if (item.keys.length === 1) {
    return 'projects.settings.hotkeys.shortcut'
  }

  return item.keys[0] === key
    ? 'projects.settings.hotkeys.primaryShortcut'
    : 'projects.settings.hotkeys.alternateShortcut'
}

function getBindingTokens(binding: string): string[] {
  return splitHotkeyBinding(binding)
}

function downloadJsonFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

async function readTextFile(file: File): Promise<string> {
  return file.text()
}

function HotkeyBindingPill({
  binding,
  isActive = false,
  isListening = false,
  isCustom = false,
  onClick,
}: {
  binding: string
  isActive?: boolean
  isListening?: boolean
  isCustom?: boolean
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const tokens = getBindingTokens(binding)
  const content =
    tokens.length > 0 ? (
      <span className="flex flex-wrap items-center justify-end gap-1.5">
        {tokens.map((token) => (
          <kbd
            key={`${binding}-${token}`}
            className={cn(
              'min-w-8 rounded-lg border px-2.5 py-1 text-[11px] font-mono tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-150 ease-out motion-reduce:transition-none',
              isActive
                ? 'border-primary/55 bg-primary/18 text-foreground'
                : 'border-white/8 bg-white/6 text-foreground/90',
              isListening && 'border-primary/60 bg-primary/20 text-primary',
            )}
          >
            {formatHotkeyBinding(token)}
          </kbd>
        ))}
        {isCustom ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            {t('projects.settings.hotkeys.custom')}
          </span>
        ) : null}
      </span>
    ) : (
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {t('projects.settings.hotkeys.unassigned')}
      </span>
    )

  if (!onClick) {
    return <div>{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl p-1 transition-colors duration-150 ease-out motion-reduce:transition-none',
        isActive ? 'bg-primary/10' : 'hover:bg-white/5',
      )}
    >
      {content}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Keyboard key cap — renders a single physical key or invisible gap spacer
// ---------------------------------------------------------------------------

const KEY_BASE_CLASSES =
  'flex h-[3.25rem] items-center justify-center rounded-lg border text-[11px] font-medium tracking-[0.06em] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_20px_rgba(0,0,0,0.22)] transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none select-none'

const KEY_ACTIVE_CLASSES =
  'border-primary/55 bg-primary/18 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_20px_rgba(255,140,58,0.14)]'

const KEY_IDLE_CLASSES =
  'border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-foreground/78'

function KeyCap({
  keySpec,
  isActive,
  isLayerKey = false,
  displayLabel,
  ariaLabel,
  tooltip,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  keySpec: KeyboardKeySpec
  isActive: boolean
  isLayerKey?: boolean
  displayLabel?: string
  ariaLabel?: string
  tooltip?: string
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  if (keySpec.isGap) {
    return <div style={{ flex: keySpec.width ?? 1 }} />
  }

  const label =
    displayLabel ?? keySpec.label ?? (keySpec.token ? formatHotkeyBinding(keySpec.token) : '')

  const capClassName = cn(
    KEY_BASE_CLASSES,
    isActive
      ? KEY_ACTIVE_CLASSES
      : isLayerKey
        ? 'border-primary/25 bg-primary/8 text-foreground/85'
        : KEY_IDLE_CLASSES,
  )

  // Interactive caps (an actionable command token) are real buttons so the whole
  // on-screen keyboard is reachable and operable via Tab/Enter. Modifier caps
  // (mod/alt/shift) aren't actionable — they render as static, non-focusable caps.
  const keyCap =
    keySpec.token && onClick ? (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isActive}
        className={cn(
          capClassName,
          'cursor-pointer hover:border-white/12 hover:text-foreground/92 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        )}
        style={{ flex: keySpec.width ?? 1 }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {label}
      </button>
    ) : (
      <div className={capClassName} style={{ flex: keySpec.width ?? 1 }} aria-hidden="true">
        {label}
      </div>
    )

  if (!tooltip) {
    return keyCap
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{keyCap}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Full-width keyboard preview — ANSI layout with navigation + arrow cluster
// ---------------------------------------------------------------------------

function KeyboardPreview({
  activeBinding,
  layerTokens,
  hoverTokens,
  tokenLabels,
  labelForToken,
  isNativeLayout,
  ariaLabel,
  emptyKeyLabel,
  layoutFallbackNote,
  onTokenHover,
  onTokenClick,
}: {
  activeBinding: string
  layerTokens: ReadonlySet<string>
  hoverTokens: ReadonlySet<string>
  tokenLabels: ReadonlyMap<string, string>
  labelForToken: (token: string) => string | null
  isNativeLayout: boolean
  ariaLabel: string
  emptyKeyLabel: (keyLabel: string) => string
  layoutFallbackNote: string
  onTokenHover: (token: string | null) => void
  onTokenClick: (token: string) => void
}) {
  const MODIFIER_TOKENS = new Set(['mod', 'alt', 'shift'])
  const activeTokens = new Set(
    getBindingTokens(activeBinding).filter((t) => !MODIFIER_TOKENS.has(t)),
  )

  const renderRow = (keys: readonly KeyboardKeySpec[]) =>
    keys.map((keySpec) => {
      const token = keySpec.token
      // Modifier caps are never actionable (handleTokenClick ignores them), so
      // they stay non-interactive — no click/hover/aria, no tab stop.
      const interactive = Boolean(token && !MODIFIER_TOKENS.has(token))
      const keyLabel = token ? (labelForToken(token) ?? undefined) : undefined
      const printedLabel = keyLabel ?? keySpec.label ?? (token ? formatHotkeyBinding(token) : '')
      const command = token ? tokenLabels.get(token) : undefined
      const ariaLabelForKey = interactive
        ? command
          ? `${printedLabel}: ${command}`
          : emptyKeyLabel(printedLabel)
        : undefined

      return (
        <KeyCap
          key={keySpec.id}
          keySpec={keySpec}
          displayLabel={keyLabel}
          ariaLabel={ariaLabelForKey}
          isActive={
            token
              ? hoverTokens.size > 0
                ? hoverTokens.has(token)
                : activeTokens.has(token)
              : false
          }
          isLayerKey={token ? layerTokens.has(token) : false}
          tooltip={interactive ? command : undefined}
          onClick={interactive ? () => onTokenClick(token!) : undefined}
          onMouseEnter={interactive ? () => onTokenHover(token!) : undefined}
          onMouseLeave={interactive ? () => onTokenHover(null) : undefined}
        />
      )
    })

  const renderRowPair = (pair: KeyboardRowPair, index: number) => (
    <div key={index} className="flex gap-3">
      {/* Main alphanumeric section */}
      <div className="flex min-w-0 flex-[15] gap-[5px]">{renderRow(pair.main)}</div>
      {/* Navigation / arrow cluster */}
      <div className="flex min-w-0 flex-[3] gap-[5px]">
        {pair.nav.length > 0 ? renderRow(pair.nav) : null}
      </div>
    </div>
  )

  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="group"
        aria-label={ariaLabel}
        className="mx-auto min-w-[760px] max-w-[1060px] space-y-[5px] xl:min-w-[900px]"
      >
        {KEYBOARD_ROWS.map((pair, i) => renderRowPair(pair, i))}
      </div>
      {!isNativeLayout ? (
        <p className="mx-auto mt-2 max-w-[1060px] text-center text-[10px] text-muted-foreground">
          {layoutFallbackNote}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Smoothly expands/collapses its content (height + fade) as it mounts/unmounts
 * inside an `AnimatePresence`. Used for the selected-command panel's contextual
 * blocks — the capture listening box, conflict warnings, browser-override note —
 * so they slide open instead of popping in and shoving the layout.
 */
function CollapseBlock({ children, reduce }: { children: ReactNode; reduce: boolean | null }) {
  return (
    <motion.div
      initial={reduce ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      style={{ overflow: 'hidden' }}
    >
      {children}
    </motion.div>
  )
}

type HotkeyFilterMode = 'all' | 'custom' | 'conflicts' | 'unassigned'

const FILTER_CHIP_MODES = ['custom', 'conflicts', 'unassigned'] as const

interface ImportChange {
  key: HotkeyKey
  labelKey: string
  from: string
  to: string
}

interface PendingHotkeyImport {
  overrides: HotkeyOverrideMap
  result: HotkeyImportResult
  changes: ImportChange[]
}

/** Per-slot diff between the live bindings and the bindings a preset would apply. */
function buildImportChanges(
  currentBindings: HotkeyBindingMap,
  nextOverrides: HotkeyOverrideMap,
): ImportChange[] {
  const nextBindings = resolveHotkeys(nextOverrides)
  const changes: ImportChange[] = []

  for (const [key, item] of Object.entries(HOTKEY_ITEM_BY_KEY) as [HotkeyKey, HotkeyEditorItem][]) {
    if (currentBindings[key] !== nextBindings[key]) {
      changes.push({
        key,
        labelKey: item.labelKey,
        from: currentBindings[key],
        to: nextBindings[key],
      })
    }
  }

  return changes
}

/** Commands matching a quick filter (customized / conflicting / unassigned). */
function getHotkeyFilterResults(
  mode: Exclude<HotkeyFilterMode, 'all'>,
  hotkeys: HotkeyBindingMap,
  overrides: HotkeyOverrideMap,
): HotkeyEditorSearchResult[] {
  const results: HotkeyEditorSearchResult[] = []

  for (const section of HOTKEY_EDITOR_SECTIONS) {
    for (const item of section.items) {
      const matches = item.keys.some((key) => {
        if (mode === 'custom') return key in overrides
        if (mode === 'unassigned') return hotkeys[key] === ''
        return findHotkeyConflicts(hotkeys, hotkeys[key], key).length > 0
      })

      if (matches) {
        results.push({ section, item })
      }
    }
  }

  return results
}

/** All three quick-filter counts in a single traversal (vs three O(N) passes). */
function computeHotkeyFilterCounts(
  hotkeys: HotkeyBindingMap,
  overrides: HotkeyOverrideMap,
): Record<Exclude<HotkeyFilterMode, 'all'>, number> {
  let custom = 0
  let conflicts = 0
  let unassigned = 0

  for (const section of HOTKEY_EDITOR_SECTIONS) {
    for (const item of section.items) {
      if (item.keys.some((key) => key in overrides)) custom += 1
      if (item.keys.some((key) => hotkeys[key] === '')) unassigned += 1
      if (item.keys.some((key) => findHotkeyConflicts(hotkeys, hotkeys[key], key).length > 0)) {
        conflicts += 1
      }
    }
  }

  return { custom, conflicts, unassigned }
}

export function HotkeyEditor() {
  const { t } = useTranslation()
  const reduceMotion = usePrefersReducedMotion()
  const hotkeys = useResolvedHotkeys()
  const hotkeyOverrides = useSettingsStore((state) => state.hotkeyOverrides)
  const setHotkeyBinding = useSettingsStore((state) => state.setHotkeyBinding)
  const unbindHotkeyBinding = useSettingsStore((state) => state.unbindHotkeyBinding)
  const replaceHotkeyOverrides = useSettingsStore((state) => state.replaceHotkeyOverrides)
  const resetHotkeyBinding = useSettingsStore((state) => state.resetHotkeyBinding)
  const resetHotkeys = useSettingsStore((state) => state.resetHotkeys)
  const layout = useKeyboardLayoutLabels()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const partialConflictOverrideSnapshotRef = useRef<typeof hotkeyOverrides | null>(null)
  // Overrides captured when a recording session began, so a completed overwrite
  // can offer a single "Undo" that reverts every unbind it caused.
  const preCaptureOverridesRef = useRef<HotkeyOverrideMap | null>(null)

  const [selectedKey, setSelectedKey] = useState<HotkeyKey>('PLAY_PAUSE')
  const [activeLayer, setActiveLayer] = useState<HotkeyEditorSection | null>(null)
  const [hoveredToken, setHoveredToken] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<HotkeyKey | null>(null)
  const [captureKey, setCaptureKey] = useState<HotkeyKey | null>(null)
  const [draftBinding, setDraftBinding] = useState('')
  const [previewBinding, setPreviewBinding] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<HotkeyFilterMode>('all')
  const [pendingImport, setPendingImport] = useState<PendingHotkeyImport | null>(null)
  const [isResetAllDialogOpen, setIsResetAllDialogOpen] = useState(false)

  // The command list's height animates to fit its content so the dialog shrinks
  // for short sections instead of leaving dead space; tall content caps and
  // scrolls. Measured from the natural content height (inside the scroller).
  const commandListRef = useRef<HTMLDivElement | null>(null)
  const commandListNatural = useNaturalHeight(commandListRef)
  const [commandListReady, setCommandListReady] = useState(false)
  useEffect(() => {
    if (commandListNatural > 0 && !commandListReady) setCommandListReady(true)
  }, [commandListNatural, commandListReady])
  const maxCommandListHeight = Math.round(
    (typeof window === 'undefined' ? 900 : window.innerHeight) * 0.5,
  )
  const commandListHeight =
    commandListNatural > 0 ? Math.min(commandListNatural, maxCommandListHeight) : undefined

  const selectedItem = HOTKEY_ITEM_BY_KEY[selectedKey]
  const isSelectedCustom = selectedKey in hotkeyOverrides
  const isSelectedUnassigned = hotkeys[selectedKey] === ''
  const customCount = Object.keys(hotkeyOverrides).length
  const isCapturingSelectedKey = captureKey === selectedKey
  const activePreviewBinding = isCapturingSelectedKey
    ? draftBinding || previewBinding || hotkeys[selectedKey]
    : hotkeys[selectedKey]
  const captureConflicts =
    captureKey && draftBinding ? findHotkeyConflicts(hotkeys, draftBinding, captureKey) : []
  const isDraftChanged = Boolean(
    captureKey && draftBinding && normalizeHotkeyBinding(draftBinding) !== hotkeys[captureKey],
  )
  const canSaveCapture = Boolean(
    captureKey &&
    draftBinding &&
    hasHotkeyPrimaryToken(draftBinding) &&
    captureConflicts.length === 0 &&
    isDraftChanged,
  )
  const selectedBrowserHotkey = getBrowserHostileHotkey(hotkeys[selectedKey])
  const pendingBrowserHotkey =
    captureKey && draftBinding ? getBrowserHostileHotkey(draftBinding) : null
  const searchResults = useMemo(
    () =>
      getHotkeyEditorSearchResults({
        query: searchQuery,
        sections: HOTKEY_EDITOR_SECTIONS,
        hotkeys,
        translate: t,
      }),
    [hotkeys, searchQuery, t],
  )
  const hasSearchQuery = searchQuery.trim().length > 0
  const isFiltering = filterMode !== 'all' && !hasSearchQuery
  const filterResults = useMemo(
    () =>
      filterMode === 'all' ? [] : getHotkeyFilterResults(filterMode, hotkeys, hotkeyOverrides),
    [filterMode, hotkeys, hotkeyOverrides],
  )
  const filterCounts = useMemo(
    () => computeHotkeyFilterCounts(hotkeys, hotkeyOverrides),
    [hotkeys, hotkeyOverrides],
  )
  const activeResults = hasSearchQuery ? searchResults : filterResults
  const showResultList = hasSearchQuery || isFiltering
  const selectedSection = useMemo(
    () =>
      HOTKEY_EDITOR_SECTIONS.find((section) =>
        section.items.some((item) => item.keys.includes(selectedKey)),
      ),
    [selectedKey],
  )
  const liveMessage = isCapturingSelectedKey
    ? draftBinding
      ? captureConflicts.length > 0
        ? t('projects.settings.hotkeys.announceConflict', {
            binding: formatHotkeyBinding(draftBinding),
            action: t(HOTKEY_ITEM_BY_KEY[captureConflicts[0]!].labelKey),
          })
        : t('projects.settings.hotkeys.announceCaptured', {
            binding: formatHotkeyBinding(draftBinding),
          })
      : t('projects.settings.hotkeys.announceRecording', { command: t(selectedItem.labelKey) })
    : ''

  const stopCapture = useCallback(
    ({ restorePartialOverwrites = true } = {}) => {
      const snapshot = partialConflictOverrideSnapshotRef.current
      partialConflictOverrideSnapshotRef.current = null

      if (restorePartialOverwrites && snapshot) {
        replaceHotkeyOverrides(snapshot)
      }

      setCaptureKey(null)
      setDraftBinding('')
      setPreviewBinding('')
    },
    [replaceHotkeyOverrides],
  )

  useEffect(() => {
    if (!captureKey) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        stopCapture()
        return
      }

      const nextBinding = getHotkeyBindingFromEventData(event)
      if (!nextBinding) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      setPreviewBinding(nextBinding)

      if (getHotkeyPrimaryTokenFromEventData(event)) {
        setDraftBinding(nextBinding)
      } else {
        setDraftBinding('')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [captureKey, stopCapture])

  useEffect(() => {
    return () => {
      const snapshot = partialConflictOverrideSnapshotRef.current
      partialConflictOverrideSnapshotRef.current = null

      if (snapshot) {
        replaceHotkeyOverrides(snapshot)
      }
    }
  }, [replaceHotkeyOverrides])

  const startCapture = (key: HotkeyKey) => {
    stopCapture()
    preCaptureOverridesRef.current = { ...useSettingsStore.getState().hotkeyOverrides }
    setSelectedKey(key)
    setCaptureKey(key)
  }

  const showUndoToast = (message: string, snapshot: HotkeyOverrideMap) => {
    toast.success(message, {
      action: {
        label: t('projects.settings.hotkeys.undo'),
        onClick: () => replaceHotkeyOverrides(snapshot),
      },
    })
  }

  // Revert to the pre-recording snapshot — used after an overwrite unbinds other
  // commands, so a single click restores everything the session changed.
  const finishCaptureWithUndo = (message: string) => {
    const snapshot = preCaptureOverridesRef.current
    preCaptureOverridesRef.current = null
    if (snapshot) {
      showUndoToast(message, snapshot)
    }
  }

  const layerTokens = useMemo(() => {
    if (!activeLayer) return new Set<string>()
    const modifiers = new Set(['mod', 'alt', 'shift'])
    const tokens = new Set<string>()
    for (const item of activeLayer.items) {
      for (const key of item.keys) {
        for (const token of splitHotkeyBinding(hotkeys[key])) {
          if (!modifiers.has(token)) tokens.add(token)
        }
      }
    }
    return tokens
  }, [activeLayer, hotkeys])

  const tokenLabels = useMemo(() => {
    const map = new Map<string, string>()
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS
    for (const section of sections) {
      for (const item of section.items) {
        const itemLabel = t(item.labelKey)
        for (const key of item.keys) {
          for (const token of splitHotkeyBinding(hotkeys[key])) {
            if (token === 'mod' || token === 'alt' || token === 'shift') continue
            const existing = map.get(token)
            if (existing) {
              if (!existing.includes(itemLabel)) {
                map.set(token, `${existing}, ${itemLabel}`)
              }
            } else {
              map.set(token, itemLabel)
            }
          }
        }
      }
    }
    return map
  }, [activeLayer, hotkeys, t])

  const hoverTokens = useMemo(() => {
    if (hoveredKey) {
      return new Set(splitHotkeyBinding(hotkeys[hoveredKey]))
    }
    if (!hoveredToken) return new Set<string>()
    const modifiers = new Set(['mod', 'alt', 'shift'])
    if (modifiers.has(hoveredToken)) return new Set<string>()
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          const tokens = splitHotkeyBinding(hotkeys[key])
          const primary = tokens.filter((t) => !modifiers.has(t))
          if (primary.includes(hoveredToken)) return new Set(tokens)
        }
      }
    }
    return new Set<string>()
  }, [hoveredToken, hoveredKey, hotkeys, activeLayer])

  const saveCapture = () => {
    if (!captureKey || !canSaveCapture) {
      return
    }

    setHotkeyBinding(captureKey, normalizeHotkeyBinding(draftBinding))
    stopCapture({ restorePartialOverwrites: false })
  }

  const overwriteConflictingHotkey = (conflictKey: HotkeyKey) => {
    if (!captureKey || !draftBinding || !hasHotkeyPrimaryToken(draftBinding)) {
      return
    }

    if (!partialConflictOverrideSnapshotRef.current) {
      partialConflictOverrideSnapshotRef.current = {
        ...useSettingsStore.getState().hotkeyOverrides,
      }
    }

    const remainingConflicts = captureConflicts.filter((key) => key !== conflictKey)
    unbindHotkeyBinding(conflictKey)

    if (remainingConflicts.length === 0) {
      setHotkeyBinding(captureKey, normalizeHotkeyBinding(draftBinding))
      stopCapture({ restorePartialOverwrites: false })
      finishCaptureWithUndo(t('projects.settings.hotkeys.reassignedToast'))
    }
  }

  const overwriteAllConflictingHotkeys = () => {
    if (!captureKey || !draftBinding || !hasHotkeyPrimaryToken(draftBinding)) {
      return
    }

    for (const conflictKey of captureConflicts) {
      unbindHotkeyBinding(conflictKey)
    }
    setHotkeyBinding(captureKey, normalizeHotkeyBinding(draftBinding))
    stopCapture({ restorePartialOverwrites: false })
    finishCaptureWithUndo(t('projects.settings.hotkeys.reassignedToast'))
  }

  const unbindSelectedHotkey = () => {
    unbindHotkeyBinding(selectedKey)
    stopCapture({ restorePartialOverwrites: false })
  }

  const resetSelectedHotkey = () => {
    resetHotkeyBinding(selectedKey)
    stopCapture({ restorePartialOverwrites: false })
  }

  const confirmResetAllHotkeys = () => {
    resetHotkeys()
    stopCapture({ restorePartialOverwrites: false })
    toast.success(t('projects.settings.hotkeys.resetAllToast'))
  }

  const handleTokenClick = (token: string) => {
    if (token === 'mod' || token === 'alt' || token === 'shift') return
    stopCapture()
    setHoveredToken(null)
    const sections = activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          const tokens = splitHotkeyBinding(hotkeys[key])
          const primary = tokens.filter((t) => t !== 'mod' && t !== 'alt' && t !== 'shift')
          if (primary.length === 1 && primary[0] === token) {
            setSelectedKey(key)
            return
          }
        }
      }
    }
    for (const section of sections) {
      for (const item of section.items) {
        for (const key of item.keys) {
          if (splitHotkeyBinding(hotkeys[key]).includes(token)) {
            setSelectedKey(key)
            return
          }
        }
      }
    }
  }

  const selectSearchResult = (item: HotkeyEditorItem) => {
    stopCapture()
    setSelectedKey(item.keys[0]!)
  }

  const exportHotkeys = () => {
    try {
      const exportDocument = createHotkeyExportDocument(hotkeyOverrides)
      const fileName = `freecut-hotkeys-${exportDocument.exportedAt.slice(0, 10)}.json`
      downloadJsonFile(`${JSON.stringify(exportDocument, null, 2)}\n`, fileName)
      toast.success(t('projects.settings.hotkeys.downloadedToast', { fileName }))
    } catch {
      toast.error(t('projects.settings.hotkeys.exportFailed'))
    }
  }

  // Parse and diff the preset, then stage it for confirmation instead of
  // silently replacing the user's whole config.
  const importHotkeys = async (file: File) => {
    try {
      const contents = await readTextFile(file)
      const importResult = parseHotkeyImportDocument(JSON.parse(contents))
      const changes = buildImportChanges(hotkeys, importResult.overrides)

      if (changes.length === 0) {
        toast.success(t('projects.settings.hotkeys.importNoChanges'))
        return
      }

      setPendingImport({ overrides: importResult.overrides, result: importResult, changes })
    } catch {
      toast.error(t('projects.settings.hotkeys.importFailed'))
    }
  }

  const applyPendingImport = () => {
    if (!pendingImport) {
      return
    }

    const snapshot = { ...useSettingsStore.getState().hotkeyOverrides }
    const { result } = pendingImport

    replaceHotkeyOverrides(pendingImport.overrides)
    stopCapture({ restorePartialOverwrites: false })
    setPendingImport(null)

    const messages = [
      t('projects.settings.hotkeys.importedCommands', { count: result.importedCommandCount }),
    ]
    if (result.remappedCommandCount > 0) {
      messages.push(
        t('projects.settings.hotkeys.remappedCount', { count: result.remappedCommandCount }),
      )
    }
    if (result.ignoredCommandCount > 0) {
      messages.push(
        t('projects.settings.hotkeys.ignoredCount', { count: result.ignoredCommandCount }),
      )
    }
    if (result.sourceVersion !== null) {
      messages.push(t('projects.settings.hotkeys.presetVersion', { version: result.sourceVersion }))
    }

    showUndoToast(messages.join(' - '), snapshot)
  }

  const handleImportButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    await importHotkeys(file)
  }

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
          <span className="text-sm font-medium text-foreground">
            {t('projects.settings.hotkeys.title')}
          </span>
          <span className="text-sm text-muted-foreground">
            {t('projects.settings.hotkeys.subtitle')}
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
          {t('projects.settings.hotkeys.customCount', { count: customCount })}
        </span>
        <DialogPrimitive.Close className="shrink-0 rounded-md border border-white/10 bg-white/5 p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </DialogPrimitive.Close>
      </div>

      {/* ── Full-width keyboard preview with section layers ── */}
      <div className="px-4 pb-3 md:px-5">
        <div className="flex min-h-[380px] overflow-hidden rounded-lg border border-white/7 bg-[#0d0d0f]/90">
          {/* Section layers sidebar */}
          <div className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-white/6 p-2 xl:w-52">
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('projects.settings.hotkeys.searchPlaceholder')}
                className="h-8 border-white/10 bg-white/5 pl-8 pr-2 text-xs"
              />
            </div>
            {!hasSearchQuery ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {FILTER_CHIP_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={filterMode === mode}
                    onClick={() => {
                      stopCapture()
                      setActiveLayer(null)
                      setFilterMode(filterMode === mode ? 'all' : mode)
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors duration-150 ease-out motion-reduce:transition-none',
                      filterMode === mode
                        ? 'border-primary/45 bg-primary/15 text-primary'
                        : 'border-white/8 bg-white/4 text-muted-foreground hover:text-foreground/80',
                    )}
                  >
                    {t(`projects.settings.hotkeys.filters.${mode}`)} {filterCounts[mode]}
                  </button>
                ))}
              </div>
            ) : null}
            {showResultList ? (
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                <div className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('projects.settings.hotkeys.searchResultCount', {
                    count: activeResults.length,
                  })}
                </div>
                <div role="list" aria-label={t('projects.settings.hotkeys.searchResults')}>
                  {activeResults.length > 0 ? (
                    activeResults.map(({ section, item }) => {
                      const resultKey = item.keys.join('|')
                      const isSelectedResult = item.keys.includes(selectedKey)

                      return (
                        <div key={resultKey} role="listitem">
                          <button
                            type="button"
                            onClick={() => selectSearchResult(item)}
                            className={cn(
                              'w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ease-out motion-reduce:transition-none',
                              isSelectedResult
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80',
                            )}
                          >
                            <div className="text-[11px] font-medium leading-4 text-foreground">
                              {t(item.labelKey)}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em]">
                              {t(section.titleKey)} ·{' '}
                              {item.keys
                                .map((key) =>
                                  getHotkeyBindingDisplayLabel(
                                    hotkeys[key],
                                    t('projects.settings.hotkeys.unassigned'),
                                  ),
                                )
                                .join(' / ')}
                            </div>
                          </button>
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-xs leading-4 text-muted-foreground">
                      {t('projects.settings.hotkeys.noSearchResults')}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    stopCapture()
                    setFilterMode('all')
                    setActiveLayer(null)
                  }}
                  className={cn(
                    'rounded-lg px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.16em] transition-colors duration-150 ease-out motion-reduce:transition-none',
                    activeLayer === null
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80',
                  )}
                >
                  {t('projects.settings.hotkeys.all')}
                </button>
                <div className="my-1 border-t border-white/6" />
                {HOTKEY_EDITOR_SECTIONS.map((section) => (
                  <button
                    key={section.titleKey}
                    type="button"
                    onClick={() => {
                      stopCapture()
                      setFilterMode('all')
                      setActiveLayer(section)
                      setSelectedKey(section.items[0]!.keys[0]!)
                    }}
                    className={cn(
                      'rounded-lg px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.16em] transition-colors duration-150 ease-out motion-reduce:transition-none',
                      activeLayer === section
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80',
                    )}
                  >
                    {t(section.titleKey)}
                  </button>
                ))}
              </>
            )}
          </div>
          {/* Keyboard */}
          <div className="flex min-w-0 flex-1 flex-col justify-center p-4 md:p-5">
            <KeyboardPreview
              activeBinding={activePreviewBinding}
              layerTokens={layerTokens}
              hoverTokens={hoverTokens}
              tokenLabels={tokenLabels}
              labelForToken={layout.labelForToken}
              isNativeLayout={layout.isNativeLayout}
              ariaLabel={t('projects.settings.hotkeys.keyboardLabel')}
              emptyKeyLabel={(keyLabel) =>
                t('projects.settings.hotkeys.keyNoCommand', { key: keyLabel })
              }
              layoutFallbackNote={t('projects.settings.hotkeys.layoutFallbackNote')}
              onTokenHover={setHoveredToken}
              onTokenClick={handleTokenClick}
            />
          </div>

          {/* Selected command panel — beside keyboard */}
          <div className="w-[280px] shrink-0 space-y-3 border-l border-white/6 p-4 pt-5">
            <div aria-live="polite" role="status" className="sr-only">
              {liveMessage}
            </div>
            <div className="border-b border-white/6 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    {t('projects.settings.hotkeys.selectedCommand')}
                  </div>
                  <div className="mt-1 text-base font-semibold tracking-tight text-foreground">
                    {t(selectedItem.labelKey)}
                  </div>
                </div>
                {isSelectedCustom ? (
                  <span className="mt-1 shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-primary">
                    {t('projects.settings.hotkeys.custom')}
                  </span>
                ) : null}
              </div>
              {selectedSection?.scopeKey ? (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-white/8 bg-white/4 px-2 py-1 text-[10px] leading-4 text-muted-foreground">
                  <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 font-medium uppercase tracking-[0.12em] text-primary">
                    {t('projects.settings.hotkeys.scopedBadge')}
                  </span>
                  <span>{t(selectedSection.scopeKey)}</span>
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {t('projects.settings.hotkeys.current')}
                </div>
                <div className="mt-1 font-medium text-foreground">
                  {getHotkeyBindingDisplayLabel(
                    hotkeys[selectedKey],
                    t('projects.settings.hotkeys.unassigned'),
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {t('projects.settings.hotkeys.default')}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {formatHotkeyBinding(HOTKEYS[selectedKey])}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              {selectedItem.keys.map((key, index) => {
                const isAlternateSlot = index > 0
                const slotBinding =
                  captureKey === key ? draftBinding || previewBinding || hotkeys[key] : hotkeys[key]
                const isSlotUnassigned = hotkeys[key] === ''

                return (
                  <div
                    key={key}
                    className={cn(
                      'rounded-lg border p-2 transition-colors duration-150 ease-out motion-reduce:transition-none',
                      selectedKey === key
                        ? 'border-primary/35 bg-primary/8'
                        : 'border-white/6 bg-white/3',
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {t(getSlotLabelKey(selectedItem, key))}
                      </span>
                      {isAlternateSlot && !isSlotUnassigned ? (
                        <button
                          type="button"
                          aria-label={t('projects.settings.hotkeys.removeBinding')}
                          onClick={() => unbindHotkeyBinding(key)}
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                    {isAlternateSlot && isSlotUnassigned && captureKey !== key ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-full justify-center gap-1 text-[11px]"
                        onClick={() => startCapture(key)}
                      >
                        <Plus className="h-3 w-3" />
                        {t('projects.settings.hotkeys.addAlternate')}
                      </Button>
                    ) : (
                      <div className="flex justify-end">
                        <HotkeyBindingPill
                          binding={slotBinding}
                          isActive={selectedKey === key}
                          isListening={captureKey === key}
                          isCustom={key in hotkeyOverrides}
                          onClick={() => startCapture(key)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <AnimatePresence initial={false}>
              {selectedBrowserHotkey ? (
                <CollapseBlock reduce={reduceMotion}>
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('projects.settings.hotkeys.browserOverride')}
                    </div>
                    <p className="mt-1 leading-4 text-foreground/84">
                      {t('projects.settings.hotkeys.mayOverride', {
                        binding: formatHotkeyBinding(selectedBrowserHotkey.binding),
                        action: selectedBrowserHotkey.browserAction.toLowerCase(),
                      })}
                    </p>
                  </div>
                </CollapseBlock>
              ) : null}
            </AnimatePresence>

            <div
              className={cn('grid gap-1.5', isCapturingSelectedKey ? 'grid-cols-2' : 'grid-cols-3')}
            >
              {isCapturingSelectedKey ? (
                <>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={saveCapture}
                    disabled={!canSaveCapture}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => stopCapture()}
                  >
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" className="w-full" onClick={() => startCapture(selectedKey)}>
                    {t('projects.settings.hotkeys.record')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={unbindSelectedHotkey}
                    disabled={isSelectedUnassigned}
                  >
                    {t('projects.settings.hotkeys.unbind')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={resetSelectedHotkey}
                    disabled={!isSelectedCustom}
                  >
                    {t('common.reset')}
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
                {t('projects.settings.hotkeys.import')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                onClick={exportHotkeys}
              >
                <Download className="h-3.5 w-3.5" />
                {t('projects.settings.hotkeys.export')}
              </Button>
            </div>

            <AnimatePresence initial={false}>
              {isCapturingSelectedKey ? (
                <CollapseBlock reduce={reduceMotion}>
                  <div className="rounded-lg border border-primary/20 bg-primary/8 p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-primary">
                      {t('projects.settings.hotkeys.listening')}
                    </div>
                    <p className="mt-1 text-xs leading-4 text-foreground/88">
                      {t('projects.settings.hotkeys.listeningHint')}
                    </p>
                    <AnimatePresence initial={false}>
                      {captureConflicts.length > 0 ? (
                        <CollapseBlock reduce={reduceMotion}>
                          <div className="mt-3 space-y-2 rounded-md border border-destructive/25 bg-destructive/8 p-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {t('projects.settings.hotkeys.conflictDetected')}
                            </div>
                            {captureConflicts.map((key) => {
                              const hotkeyItem = HOTKEY_ITEM_BY_KEY[key]

                              return (
                                <div
                                  key={key}
                                  className="flex items-center justify-between gap-2 text-xs text-foreground/88"
                                >
                                  <span className="min-w-0 flex-1">
                                    {t('projects.settings.hotkeys.conflictsWith', {
                                      action: t(hotkeyItem.labelKey),
                                    })}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-6 shrink-0 px-2 text-[10px]"
                                    onClick={() => overwriteConflictingHotkey(key)}
                                  >
                                    {t('projects.settings.hotkeys.overwrite')}
                                  </Button>
                                </div>
                              )
                            })}
                            {captureConflicts.length > 1 ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 w-full px-2 text-[11px]"
                                onClick={overwriteAllConflictingHotkeys}
                              >
                                {t('projects.settings.hotkeys.overwriteAll')}
                              </Button>
                            ) : null}
                          </div>
                        </CollapseBlock>
                      ) : null}
                    </AnimatePresence>
                    <AnimatePresence initial={false}>
                      {pendingBrowserHotkey ? (
                        <CollapseBlock reduce={reduceMotion}>
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              {t('projects.settings.hotkeys.thisOverrides', {
                                action: pendingBrowserHotkey.browserAction.toLowerCase(),
                              })}
                            </span>
                          </div>
                        </CollapseBlock>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </CollapseBlock>
              ) : null}
            </AnimatePresence>

            <p className="text-[11px] leading-4 text-muted-foreground">
              {t('projects.settings.hotkeys.importExportHint')}
            </p>

            <div className="border-t border-white/6 pt-3">
              <AlertDialog open={isResetAllDialogOpen} onOpenChange={setIsResetAllDialogOpen}>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => setIsResetAllDialogOpen(true)}
                  disabled={customCount === 0}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('projects.settings.hotkeys.resetAll')}
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('projects.settings.hotkeys.resetAllConfirmTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('projects.settings.hotkeys.resetAllConfirmDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={confirmResetAllHotkeys}
                    >
                      {t('projects.settings.hotkeys.resetAllConfirmAction')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>

      {/* ── Command list — height animates to fit its content so the dialog
          shrinks for short sections; tall content caps at 50vh and scrolls. ── */}
      <motion.div
        className="min-h-0 overflow-hidden border-t border-white/8"
        initial={false}
        animate={{ height: commandListHeight ?? 'auto' }}
        transition={
          reduceMotion || !commandListReady
            ? { duration: 0 }
            : { type: 'spring', stiffness: 460, damping: 42, mass: 0.9 }
        }
      >
        <div className="h-full overflow-y-auto">
          <div ref={commandListRef} className="columns-[240px] gap-x-2 gap-y-0 px-4 py-2 md:px-5">
            {(activeLayer ? [activeLayer] : HOTKEY_EDITOR_SECTIONS).map((section) => (
              <div key={section.titleKey} className="break-inside-avoid">
                {!activeLayer ? (
                  <div className="mb-0.5 mt-1.5 first:mt-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t(section.titleKey)}
                  </div>
                ) : null}
                {section.items.map((item) => (
                  <div
                    key={`${section.titleKey}-${item.labelKey}`}
                    className={cn(
                      'mb-1 break-inside-avoid rounded border px-2 py-1 text-left transition-colors duration-150 ease-out motion-reduce:transition-none',
                      hoveredToken || hoveredKey
                        ? (hoveredKey && item.keys.includes(hoveredKey)) ||
                          (hoveredToken &&
                            item.keys.some((k) =>
                              splitHotkeyBinding(hotkeys[k]).includes(hoveredToken),
                            ))
                          ? 'border-primary/35 bg-primary/10'
                          : 'border-white/7 bg-white/4'
                        : item.keys.includes(selectedKey)
                          ? 'border-primary/35 bg-primary/10'
                          : 'border-white/7 bg-white/4 hover:border-white/12 hover:bg-white/6',
                    )}
                    onMouseEnter={() => setHoveredKey(item.keys[0]!)}
                    onMouseLeave={() => setHoveredKey(null)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          stopCapture()
                          setSelectedKey(item.keys[0]!)
                        }}
                        className="min-w-0 flex-1 rounded text-left text-[12px] leading-5 text-foreground/92 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                      >
                        {t(item.labelKey)}
                      </button>
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
                            isCustom={key in hotkeyOverrides}
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
      </motion.div>

      {/* Import review — confirm a preset before it replaces the current config. */}
      <AlertDialog
        open={pendingImport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingImport(null)
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projects.settings.hotkeys.importReviewTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('projects.settings.hotkeys.importReviewDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingImport ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t('projects.settings.hotkeys.importChangeCount', {
                  count: pendingImport.changes.length,
                })}
                {customCount > 0
                  ? ` · ${t('projects.settings.hotkeys.importReplaceCount', { count: customCount })}`
                  : ''}
                {pendingImport.result.ignoredCommandCount > 0
                  ? ` · ${t('projects.settings.hotkeys.ignoredCount', {
                      count: pendingImport.result.ignoredCommandCount,
                    })}`
                  : ''}
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-white/8 bg-white/3 p-2">
                {pendingImport.changes.map((change) => (
                  <div key={change.key} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {t(change.labelKey)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px]">
                      <span className="text-muted-foreground line-through">
                        {getHotkeyBindingDisplayLabel(
                          change.from,
                          t('projects.settings.hotkeys.unassigned'),
                        )}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium text-foreground">
                        {getHotkeyBindingDisplayLabel(
                          change.to,
                          t('projects.settings.hotkeys.unassigned'),
                        )}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={applyPendingImport}>
              {t('projects.settings.hotkeys.importApply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
