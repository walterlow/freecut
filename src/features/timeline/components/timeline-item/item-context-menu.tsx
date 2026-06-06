import { memo, ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { LazyContextMenuEventInit } from '../../utils/lazy-context-menu'
import { captureContextMenuEventInit, replayContextMenuEvent } from '../../utils/lazy-context-menu'
import { useSelectionStore } from '@/shared/state/selection'
import { PROPERTY_LABELS, type AnimatableProperty } from '@/types/keyframe'
import type { PropertyKeyframes } from '@/types/keyframe'
import {
  getSceneVerificationModelOptions,
  type VerificationModel,
} from '@/features/timeline/deps/analysis'
import { formatHotkeyBinding } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'

type ItemContextMenuSectionProps = {
  t: ReturnType<typeof useTranslation>['t']
  hotkeys: ReturnType<typeof useResolvedHotkeys>
}

type JoinActionsProps = ItemContextMenuSectionProps & {
  canJoinSelected: boolean
  hasJoinableLeft: boolean
  hasJoinableRight: boolean
  closerEdge: 'left' | 'right' | null
  onJoinSelected: () => void
  onJoinLeft: () => void
  onJoinRight: () => void
}

type LinkActionsProps = ItemContextMenuSectionProps & {
  canLinkSelected?: boolean
  canUnlinkSelected?: boolean
  onLinkSelected?: () => void
  onUnlinkSelected?: () => void
}

type KeyframeActionsProps = ItemContextMenuSectionProps & {
  propertiesWithKeyframes: PropertyKeyframes[]
  onClearAllKeyframes?: () => void
  onClearPropertyKeyframes?: (property: AnimatableProperty) => void
}

type SceneDetectionActionsProps = ItemContextMenuSectionProps & {
  canDetectScenes?: boolean
  isDetectingScenes?: boolean
  sceneVerificationModelOptions: ReturnType<typeof getSceneVerificationModelOptions>
  onDetectScenes?: (
    method: 'histogram' | 'optical-flow',
    verificationModel?: VerificationModel,
  ) => void
}

type CaptionActionsProps = ItemContextMenuSectionProps & {
  canManageCaptions?: boolean
  hasCaptions?: boolean
  hasTranscript?: boolean
  isGeneratingCaptions?: boolean
  canExtractEmbeddedSubtitles?: boolean
  canConsolidateCaptionsToSegment?: boolean
  onOpenCaptionDialog?: () => void
  onApplyCaptionsFromTranscript?: () => void
  onExtractEmbeddedSubtitles?: () => void
  onConsolidateCaptionsToSegment?: () => void
}

type CompositionActionsProps = ItemContextMenuSectionProps & {
  isCompositionItem?: boolean
  canCreatePreComp?: boolean
  onEnterComposition?: () => void
  onDissolveComposition?: () => void
  onCreatePreComp?: () => void
}

type MediaActionsProps = ItemContextMenuSectionProps & {
  canReverse?: boolean
  isReversed?: boolean
  isVideoItem?: boolean
  playheadInBounds?: boolean
  canRemoveSilence?: boolean
  isRemovingSilence?: boolean
  canRemoveFillers?: boolean
  isRemovingFillers?: boolean
  isTextItem?: boolean
  onReverse?: () => void
  onFreezeFrame?: () => void
  onRemoveSilence?: () => void
  onRemoveFillers?: () => void
  onGenerateAudioFromText?: () => void
}

type LayoutActionsProps = ItemContextMenuSectionProps & {
  selectedCount: number
  onBentoLayout?: () => void
}

type DestructiveActionsProps = ItemContextMenuSectionProps & {
  isSelected: boolean
  onRippleDelete: () => void
  onDelete: () => void
}

type JoinActionsConfig = Omit<JoinActionsProps, keyof ItemContextMenuSectionProps>
type LinkActionsConfig = Omit<LinkActionsProps, keyof ItemContextMenuSectionProps>
type MediaActionsConfig = Omit<MediaActionsProps, keyof ItemContextMenuSectionProps>
type CaptionActionsConfig = Omit<CaptionActionsProps, keyof ItemContextMenuSectionProps>
type CompositionActionsConfig = Omit<CompositionActionsProps, keyof ItemContextMenuSectionProps>
type DestructiveActionsConfig = Omit<DestructiveActionsProps, keyof ItemContextMenuSectionProps>

type KeyframeActionsConfig = Omit<
  KeyframeActionsProps,
  keyof ItemContextMenuSectionProps | 'propertiesWithKeyframes'
> & {
  keyframedProperties?: PropertyKeyframes[]
}

type SceneDetectionActionsConfig = Omit<
  SceneDetectionActionsProps,
  keyof ItemContextMenuSectionProps | 'sceneVerificationModelOptions'
>

type LayoutActionsConfig = {
  onBentoLayout?: () => void
}

interface ItemContextMenuProps {
  children: ReactNode
  trackLocked: boolean
  joinActions: JoinActionsConfig
  destructiveActions: DestructiveActionsConfig
  linkActions?: LinkActionsConfig
  keyframeActions?: KeyframeActionsConfig
  layoutActions?: LayoutActionsConfig
  mediaActions?: MediaActionsConfig
  sceneDetectionActions?: SceneDetectionActionsConfig
  captionActions?: CaptionActionsConfig
  compositionActions?: CompositionActionsConfig
}

/**
 * Context menu for timeline items
 * Provides delete, ripple delete, join, and keyframe clearing operations
 *
 * Uses lazy mounting: the heavy Radix ContextMenu tree (10+ provider components)
 * is only mounted after the user first right-clicks. Before that, children render
 * directly without the ContextMenu wrapper, eliminating thousands of unnecessary
 * re-renders during drag operations (119 items × ~10 Radix components each).
 */
export const ItemContextMenu = memo(function ItemContextMenu({
  children,
  trackLocked,
  joinActions,
  destructiveActions,
  linkActions,
  keyframeActions,
  layoutActions,
  mediaActions,
  sceneDetectionActions,
  captionActions,
  compositionActions,
}: ItemContextMenuProps) {
  // Lazy mount: defer the full Radix ContextMenu tree until first right-click.
  // This eliminates ~10 Radix provider components per item from the render tree
  // during normal operation (drag, playback, scrub), where context menus are never
  // needed. With 100+ items, this avoids millions of unnecessary re-renders.
  const [hasActivated, setHasActivated] = useState(false)
  const [pendingActivation, setPendingActivation] = useState<LazyContextMenuEventInit | null>(null)

  if (!hasActivated) {
    return (
      <ItemContextMenuTriggerOnly
        trackLocked={trackLocked}
        onActivate={(eventInit) => {
          setPendingActivation(eventInit)
          setHasActivated(true)
        }}
      >
        {children}
      </ItemContextMenuTriggerOnly>
    )
  }

  return (
    <ItemContextMenuFull
      trackLocked={trackLocked}
      joinActions={joinActions}
      destructiveActions={destructiveActions}
      linkActions={linkActions}
      keyframeActions={keyframeActions}
      layoutActions={layoutActions}
      mediaActions={mediaActions}
      sceneDetectionActions={sceneDetectionActions}
      captionActions={captionActions}
      compositionActions={compositionActions}
      pendingActivation={pendingActivation}
      onPendingActivationHandled={() => setPendingActivation(null)}
    >
      {children}
    </ItemContextMenuFull>
  )
})

/**
 * Lightweight placeholder: just renders children with a contextmenu listener.
 * No Radix providers, no Popper, no Menu — zero overhead.
 */
const ItemContextMenuTriggerOnly = memo(function ItemContextMenuTriggerOnly({
  children,
  trackLocked,
  onActivate,
}: {
  children: ReactNode
  trackLocked: boolean
  onActivate: (eventInit: LazyContextMenuEventInit) => void
}) {
  return (
    <span
      data-item-context-anchor
      style={{ display: 'contents' }}
      onContextMenu={(e) => {
        if (trackLocked) return
        e.stopPropagation()
        e.preventDefault()
        onActivate(captureContextMenuEventInit(e.nativeEvent))
      }}
    >
      {children}
    </span>
  )
})

/**
 * Full Radix ContextMenu tree — only mounted after first right-click activation.
 */
const ItemContextMenuFull = memo(function ItemContextMenuFull({
  children,
  trackLocked,
  joinActions,
  destructiveActions,
  linkActions,
  keyframeActions,
  layoutActions,
  mediaActions,
  sceneDetectionActions,
  captionActions,
  compositionActions,
  pendingActivation,
  onPendingActivationHandled,
}: Omit<ItemContextMenuProps, 'children'> & {
  children: ReactNode
  pendingActivation?: LazyContextMenuEventInit | null
  onPendingActivationHandled?: () => void
}) {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const hotkeys = useResolvedHotkeys()
  const selectedCount = useSelectionStore((s) => s.selectedItemIds.length)
  // Filter to only properties that actually have keyframes
  const propertiesWithKeyframes = useMemo(() => {
    if (!keyframeActions?.keyframedProperties) return []
    return keyframeActions.keyframedProperties.filter((p) => p.keyframes.length > 0)
  }, [keyframeActions?.keyframedProperties])
  const sceneVerificationModelOptions = useMemo(() => getSceneVerificationModelOptions(), [])

  useLayoutEffect(() => {
    if (!pendingActivation || !triggerRef.current) {
      return
    }

    replayContextMenuEvent(triggerRef.current, pendingActivation)
    onPendingActivationHandled?.()
  }, [onPendingActivationHandled, pendingActivation])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={trackLocked}>
        <span ref={triggerRef} data-item-context-anchor style={{ display: 'contents' }}>
          {children}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <JoinActions t={t} hotkeys={hotkeys} {...joinActions} />
        {linkActions && <LinkActions t={t} hotkeys={hotkeys} {...linkActions} />}
        <KeyframeActions
          t={t}
          hotkeys={hotkeys}
          propertiesWithKeyframes={propertiesWithKeyframes}
          onClearAllKeyframes={keyframeActions?.onClearAllKeyframes}
          onClearPropertyKeyframes={keyframeActions?.onClearPropertyKeyframes}
        />
        <LayoutActions
          t={t}
          hotkeys={hotkeys}
          selectedCount={selectedCount}
          onBentoLayout={layoutActions?.onBentoLayout}
        />
        {mediaActions && <MediaActions t={t} hotkeys={hotkeys} {...mediaActions} />}
        {sceneDetectionActions && (
          <SceneDetectionActions
            t={t}
            hotkeys={hotkeys}
            sceneVerificationModelOptions={sceneVerificationModelOptions}
            {...sceneDetectionActions}
          />
        )}
        {captionActions && <CaptionActions t={t} hotkeys={hotkeys} {...captionActions} />}
        {compositionActions && (
          <CompositionActions t={t} hotkeys={hotkeys} {...compositionActions} />
        )}
        <DestructiveActions t={t} hotkeys={hotkeys} {...destructiveActions} />
      </ContextMenuContent>
    </ContextMenu>
  )
})

function JoinActions({
  t,
  canJoinSelected,
  hasJoinableLeft,
  hasJoinableRight,
  closerEdge,
  onJoinSelected,
  onJoinLeft,
  onJoinRight,
}: JoinActionsProps) {
  const showJoinLeft = hasJoinableLeft && (closerEdge === 'left' || !hasJoinableRight)
  const showJoinRight = hasJoinableRight && (closerEdge === 'right' || !hasJoinableLeft)
  const hasJoinOption = showJoinLeft || showJoinRight || canJoinSelected

  if (!hasJoinOption) return null

  return (
    <>
      {showJoinLeft && (
        <ContextMenuItem onClick={onJoinLeft}>
          {t('timeline.contextMenu.joinWithPrevious')}
          <ContextMenuShortcut>J</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {showJoinRight && (
        <ContextMenuItem onClick={onJoinRight}>
          {t('timeline.contextMenu.joinWithNext')}
          <ContextMenuShortcut>J</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {canJoinSelected && (
        <ContextMenuItem onClick={onJoinSelected}>
          {t('timeline.contextMenu.joinSelected')}
          <ContextMenuShortcut>J</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  )
}

function LinkActions({
  t,
  hotkeys,
  canLinkSelected,
  canUnlinkSelected,
  onLinkSelected,
  onUnlinkSelected,
}: LinkActionsProps) {
  if (!canLinkSelected && !canUnlinkSelected) return null

  return (
    <>
      {canLinkSelected && onLinkSelected && (
        <ContextMenuItem onClick={onLinkSelected}>
          {t('timeline.contextMenu.linkClips')}
          <ContextMenuShortcut>{formatHotkeyBinding(hotkeys.LINK_AUDIO_VIDEO)}</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      {canUnlinkSelected && onUnlinkSelected && (
        <ContextMenuItem onClick={onUnlinkSelected}>
          {t('timeline.contextMenu.unlinkClips')}
          <ContextMenuShortcut>
            {formatHotkeyBinding(hotkeys.UNLINK_AUDIO_VIDEO)}
          </ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  )
}

function KeyframeActions({
  t,
  hotkeys,
  propertiesWithKeyframes,
  onClearAllKeyframes,
  onClearPropertyKeyframes,
}: KeyframeActionsProps) {
  if (propertiesWithKeyframes.length === 0) return null

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t('timeline.contextMenu.clearKeyframes')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48">
          <ContextMenuItem onClick={onClearAllKeyframes}>
            {t('timeline.contextMenu.clearAll')}
            <ContextMenuShortcut>
              {formatHotkeyBinding(hotkeys.CLEAR_KEYFRAMES)}
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          {propertiesWithKeyframes.map(({ property }) => (
            <ContextMenuItem key={property} onClick={() => onClearPropertyKeyframes?.(property)}>
              {PROPERTY_LABELS[property]}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
    </>
  )
}

function LayoutActions({ t, selectedCount, onBentoLayout }: LayoutActionsProps) {
  if (selectedCount < 2 || !onBentoLayout) return null

  return (
    <>
      <ContextMenuItem onClick={onBentoLayout}>
        {t('timeline.contextMenu.bentoLayout')}
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  )
}

function MediaActions({
  t,
  canReverse,
  isReversed,
  isVideoItem,
  playheadInBounds,
  canRemoveSilence,
  isRemovingSilence,
  canRemoveFillers,
  isRemovingFillers,
  isTextItem,
  onReverse,
  onFreezeFrame,
  onRemoveSilence,
  onRemoveFillers,
  onGenerateAudioFromText,
}: MediaActionsProps) {
  return (
    <>
      {canReverse && onReverse && (
        <>
          <ContextMenuItem onClick={onReverse}>
            {isReversed ? t('timeline.contextMenu.unreverse') : t('timeline.contextMenu.reverse')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      {isVideoItem && playheadInBounds && onFreezeFrame && (
        <>
          <ContextMenuItem onClick={onFreezeFrame}>
            {t('timeline.contextMenu.insertFreezeFrame')}
            <ContextMenuShortcut>Shift+F</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      {canRemoveSilence && onRemoveSilence && (
        <>
          <ContextMenuItem onClick={onRemoveSilence} disabled={isRemovingSilence}>
            {isRemovingSilence
              ? t('timeline.contextMenu.detectingSilence')
              : t('timeline.contextMenu.removeSilence')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      {canRemoveFillers && onRemoveFillers && (
        <>
          <ContextMenuItem onClick={onRemoveFillers} disabled={isRemovingFillers}>
            {isRemovingFillers
              ? t('timeline.contextMenu.detectingFillers')
              : t('timeline.contextMenu.removeFillerWords')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      {isTextItem && onGenerateAudioFromText && (
        <>
          <ContextMenuItem onClick={onGenerateAudioFromText}>
            {t('timeline.contextMenu.generateAudioFromText')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
    </>
  )
}

function SceneDetectionActions({
  t,
  canDetectScenes,
  isDetectingScenes,
  sceneVerificationModelOptions,
  onDetectScenes,
}: SceneDetectionActionsProps) {
  if (!canDetectScenes || !onDetectScenes) return null

  return (
    <>
      {isDetectingScenes ? (
        <ContextMenuItem disabled>{t('timeline.contextMenu.detectingScenes')}</ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            {t('timeline.contextMenu.detectScenesAndSplit')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-48">
            <ContextMenuItem onClick={() => onDetectScenes('histogram')}>
              {t('timeline.contextMenu.detectScenesFast')}
            </ContextMenuItem>
            {sceneVerificationModelOptions.map((option) => (
              <ContextMenuItem
                key={option.value}
                onClick={() => onDetectScenes('optical-flow', option.value)}
              >
                {t('timeline.contextMenu.detectScenesAi', { model: option.label })}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
    </>
  )
}

function CaptionActions({
  t,
  canManageCaptions,
  hasCaptions,
  hasTranscript,
  isGeneratingCaptions,
  canExtractEmbeddedSubtitles,
  canConsolidateCaptionsToSegment,
  onOpenCaptionDialog,
  onApplyCaptionsFromTranscript,
  onExtractEmbeddedSubtitles,
  onConsolidateCaptionsToSegment,
}: CaptionActionsProps) {
  const captionActionLabel = hasCaptions
    ? t('timeline.contextMenu.regenerateCaptions')
    : t('timeline.contextMenu.generateCaptions')

  return (
    <>
      {canManageCaptions && onOpenCaptionDialog && (
        <>
          {isGeneratingCaptions ? (
            <ContextMenuItem disabled>{t('timeline.contextMenu.updatingCaptions')}</ContextMenuItem>
          ) : hasTranscript && onApplyCaptionsFromTranscript ? (
            <ContextMenuSub>
              <ContextMenuSubTrigger>{t('timeline.contextMenu.captions')}</ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-56">
                <ContextMenuItem onClick={onApplyCaptionsFromTranscript}>
                  {t('timeline.contextMenu.insertExistingCaptions')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onOpenCaptionDialog}>
                  {captionActionLabel}
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          ) : (
            <ContextMenuItem onClick={onOpenCaptionDialog}>{captionActionLabel}</ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}

      {canExtractEmbeddedSubtitles && onExtractEmbeddedSubtitles && (
        <>
          <ContextMenuItem onClick={onExtractEmbeddedSubtitles}>
            {t('timeline.contextMenu.extractEmbeddedSubtitles')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      {canConsolidateCaptionsToSegment && onConsolidateCaptionsToSegment && (
        <>
          <ContextMenuItem onClick={onConsolidateCaptionsToSegment}>
            {t('timeline.contextMenu.consolidateCaptionsToSegment')}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
    </>
  )
}

function CompositionActions({
  t,
  isCompositionItem,
  canCreatePreComp,
  onEnterComposition,
  onDissolveComposition,
  onCreatePreComp,
}: CompositionActionsProps) {
  const hasCompositionActions =
    (isCompositionItem && (onEnterComposition || onDissolveComposition)) ||
    (canCreatePreComp && onCreatePreComp)

  if (!hasCompositionActions) return null

  return (
    <>
      {isCompositionItem && onEnterComposition && (
        <ContextMenuItem onClick={onEnterComposition}>
          {t('timeline.contextMenu.openCompoundClip')}
        </ContextMenuItem>
      )}
      {isCompositionItem && onDissolveComposition && (
        <ContextMenuItem onClick={onDissolveComposition}>
          {t('timeline.contextMenu.dissolveCompoundClip')}
        </ContextMenuItem>
      )}
      {canCreatePreComp && onCreatePreComp && (
        <ContextMenuItem onClick={onCreatePreComp}>
          {t('timeline.contextMenu.createCompoundClip')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  )
}

function DestructiveActions({ t, isSelected, onRippleDelete, onDelete }: DestructiveActionsProps) {
  return (
    <>
      <ContextMenuItem
        onClick={onRippleDelete}
        disabled={!isSelected}
        className="text-destructive focus:text-destructive"
      >
        {t('timeline.contextMenu.rippleDelete')}
        <ContextMenuShortcut>Ctrl+Del</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        onClick={onDelete}
        disabled={!isSelected}
        className="text-destructive focus:text-destructive"
      >
        {t('common.delete')}
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}
