import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Type, Palette, WandSparkles } from 'lucide-react'
import type { TextItem, TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { KeyframeToggle } from '@/features/editor/deps/keyframes'
import { TextMotionSlotRows } from '../../text-motion/text-motion-slot-rows'
import { PropertySection, PropertyRow, SliderInput } from '../components'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import { useTextSectionSelection } from './use-text-section-selection'
import { useTextSectionHandlers } from './use-text-section-handlers'
import { TextTypographyControls } from './text-typography-controls'
import { TextLayoutControls, TextPlainEditor, TextSpanEditors } from './text-content-controls'
import { TextAlignControls } from './text-align-controls'
import { TextColorControls } from './text-color-controls'
import { TextBoxControls } from './text-box-controls'
import { TextEffectsControls } from './text-effects-controls'

interface TextSectionProps {
  items: TimelineItem[]
  canvas: CanvasSettings
}

type TextSectionSlot = 'content' | 'effects' | 'animation'

interface TextSectionComposerProps extends TextSectionProps {
  slots: TextSectionSlot[]
}

export function TextContentSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['content']} />
}

/** Style (shadow / stroke / style presets) on its own — the Text tab. */
export function TextStyleSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['effects']} />
}

/**
 * Style + animation together — used only for mixed (text + non-text)
 * selections, which keep the general Effects-tab layout.
 */
export function TextEffectsSection(props: TextSectionProps) {
  return <TextSectionComposer {...props} slots={['effects', 'animation']} />
}

function TextSectionComposer({ items, canvas, slots }: TextSectionComposerProps) {
  const { t } = useTranslation()

  // Gizmo store for live property preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew)
  const clearPreview = useGizmoStore((s) => s.clearPreview)

  const {
    textItems,
    itemIds,
    sharedValues,
    baseShadow,
    baseStroke,
    activeEditorSpans,
    firstTextItem,
    hasStructuredSpanEditor,
    supportedFontWeightOptions,
  } = useTextSectionSelection(items)

  const previousFontFamilyRef = useRef<string | undefined>(sharedValues?.fontFamily)
  const sharedFontWeightRef = useRef<TextItem['fontWeight'] | undefined>(sharedValues?.fontWeight)
  sharedFontWeightRef.current = sharedValues?.fontWeight

  const {
    updateTextItems,
    handleTextChange,
    handleApplySpanLayout,
    handleSpanTextChange,
    handleSpanFontSizeChange,
    handleSpanFontSizeLiveChange,
    handleSpanLetterSpacingChange,
    handleSpanLetterSpacingLiveChange,
    handleSpanFontFamilyChange,
    handleSpanColorChange,
    handleSpanColorLiveChange,
    handleSpanWeightChange,
    handleSpanItalicToggle,
    handleSpanUnderlineToggle,
    handleFontSizeLiveChange,
    handleFontSizeChange,
    handleFontFamilyChange,
    handleFontWeightChange,
    handleBoldToggle,
    handleItalicToggle,
    handleUnderlineToggle,
    handleColorLiveChange,
    handleColorChange,
    handleBackgroundColorLiveChange,
    handleBackgroundColorChange,
    handleBackgroundColorClear,
    handleBackgroundRadiusLiveChange,
    handleBackgroundRadiusChange,
    handleTextAlignChange,
    handleVerticalAlignChange,
    handleLetterSpacingLiveChange,
    handleLetterSpacingChange,
    handleLineHeightLiveChange,
    handleLineHeightChange,
    handleTextPaddingLiveChange,
    handleTextPaddingChange,
    handleShadowColorLiveChange,
    handleShadowColorChange,
    handleShadowOffsetXLiveChange,
    handleShadowOffsetXChange,
    handleShadowOffsetYLiveChange,
    handleShadowOffsetYChange,
    handleShadowBlurLiveChange,
    handleShadowBlurChange,
    handleStrokeWidthLiveChange,
    handleStrokeWidthChange,
    handleStrokeColorLiveChange,
    handleStrokeColorChange,
    handleApplyTextEffectPreset,
    handleApplyTextStylePreset,
    handleTextStyleScaleChange,
  } = useTextSectionHandlers({
    textItems,
    itemIds,
    sharedValues,
    baseShadow,
    baseStroke,
    activeEditorSpans,
    firstTextItem,
    supportedFontWeightOptions,
    canvas,
    setPropertiesPreviewNew,
    clearPreview,
  })

  useEffect(() => {
    const currentFontFamily = sharedValues?.fontFamily
    if (previousFontFamilyRef.current === currentFontFamily) {
      return
    }

    previousFontFamilyRef.current = currentFontFamily

    const currentWeight = sharedFontWeightRef.current
    if (!currentWeight) {
      return
    }

    if (supportedFontWeightOptions.some((weight) => weight.value === currentWeight)) {
      return
    }

    const fallbackWeight = supportedFontWeightOptions[0]?.value
    if (!fallbackWeight) {
      return
    }

    updateTextItems({ fontWeight: fallbackWeight })
  }, [sharedValues?.fontFamily, supportedFontWeightOptions, updateTextItems])

  if (textItems.length === 0 || !sharedValues) {
    return null
  }

  const fontPreviewText =
    sharedValues.text ?? (firstTextItem ? getTextItemPlainText(firstTextItem) : '')
  const shadowOffsetX = sharedValues.shadowOffsetX
  const shadowOffsetY = sharedValues.shadowOffsetY
  const shadowBlur = sharedValues.shadowBlur
  const strokeWidth = sharedValues.strokeWidth
  const backgroundColorValue =
    sharedValues.backgroundColor || textItems[0]?.backgroundColor || '#000000'
  const hasAnyBackground = textItems.some((item) => item.backgroundColor !== undefined)
  const textPadding = sharedValues.textPadding
  const backgroundRadius = sharedValues.backgroundRadius
  const showContentSection = slots.includes('content')
  const showEffectSection = slots.includes('effects')
  const showAnimationSection = slots.includes('animation')

  return (
    <>
      {showContentSection && (
        <PropertySection
          title={t('editor.textSection.sectionTitle')}
          icon={Type}
          defaultOpen={true}
        >
          {/* Content editors run full-width (no gutter label) directly under
              the TEXT section header — no redundant "Content" sub-header. */}
          <div className="flex w-full min-w-0 flex-col gap-2">
            <TextLayoutControls
              hasStructuredSpans={Boolean(firstTextItem?.textSpans?.length)}
              activeSpanCount={activeEditorSpans.length}
              presetId={sharedValues.textStylePresetId}
              onApplyLayout={handleApplySpanLayout}
              onApplyStylePreset={handleApplyTextStylePreset}
            />
            {firstTextItem?.textSpans?.length ? (
              <TextSpanEditors
                spans={activeEditorSpans}
                fallbackItem={firstTextItem}
                onSpanTextChange={handleSpanTextChange}
                onSpanFontFamilyChange={handleSpanFontFamilyChange}
                onSpanFontSizeChange={handleSpanFontSizeChange}
                onSpanFontSizeLiveChange={handleSpanFontSizeLiveChange}
                onSpanWeightChange={handleSpanWeightChange}
                onSpanLetterSpacingChange={handleSpanLetterSpacingChange}
                onSpanLetterSpacingLiveChange={handleSpanLetterSpacingLiveChange}
                onSpanColorChange={handleSpanColorChange}
                onSpanColorLiveChange={handleSpanColorLiveChange}
                onSpanItalicToggle={handleSpanItalicToggle}
                onSpanUnderlineToggle={handleSpanUnderlineToggle}
              />
            ) : (
              <TextPlainEditor
                value={sharedValues.text ?? ''}
                isMixed={sharedValues.text === undefined}
                onChange={handleTextChange}
              />
            )}
          </div>
          {sharedValues.textStylePresetId && (
            <PropertyRow label={t('editor.textSection.scale')}>
              <div className="flex items-center gap-1 min-w-0 w-full">
                <SliderInput
                  value={sharedValues.textStyleScale}
                  onChange={handleTextStyleScaleChange}
                  min={0.5}
                  max={6}
                  step={0.05}
                  unit="x"
                  formatValue={(value) => `${value.toFixed(2)}x`}
                  className="flex-1 min-w-0"
                />
                <KeyframeToggle
                  itemIds={itemIds}
                  property="textStyleScale"
                  currentValue={firstTextItem?.textStyleScale ?? 1}
                />
              </div>
            </PropertyRow>
          )}

          <TextTypographyControls
            enabled={!hasStructuredSpanEditor}
            fontFamily={sharedValues.fontFamily}
            fontSize={sharedValues.fontSize}
            fontWeight={sharedValues.fontWeight}
            fontStyle={sharedValues.fontStyle}
            underline={sharedValues.underline}
            fontPreviewText={fontPreviewText}
            supportedFontWeightOptions={supportedFontWeightOptions}
            itemIds={itemIds}
            fontSizeCurrentValue={firstTextItem?.fontSize ?? 60}
            onFontFamilyChange={handleFontFamilyChange}
            onFontSizeChange={handleFontSizeChange}
            onFontSizeLiveChange={handleFontSizeLiveChange}
            onFontWeightChange={handleFontWeightChange}
            onBoldToggle={handleBoldToggle}
            onItalicToggle={handleItalicToggle}
            onUnderlineToggle={handleUnderlineToggle}
          />

          <TextAlignControls
            textAlign={sharedValues.textAlign}
            verticalAlign={sharedValues.verticalAlign}
            onTextAlignChange={handleTextAlignChange}
            onVerticalAlignChange={handleVerticalAlignChange}
          />

          <TextColorControls
            enabled={!hasStructuredSpanEditor}
            color={sharedValues.color}
            backgroundColor={backgroundColorValue}
            hasAnyBackground={hasAnyBackground}
            letterSpacing={sharedValues.letterSpacing}
            onColorChange={handleColorChange}
            onColorLiveChange={handleColorLiveChange}
            onBackgroundColorChange={handleBackgroundColorChange}
            onBackgroundColorLiveChange={handleBackgroundColorLiveChange}
            onBackgroundColorClear={handleBackgroundColorClear}
            onLetterSpacingChange={handleLetterSpacingChange}
            onLetterSpacingLiveChange={handleLetterSpacingLiveChange}
          />

          <TextBoxControls
            lineHeight={sharedValues.lineHeight}
            textPadding={textPadding}
            backgroundRadius={backgroundRadius}
            itemIds={itemIds}
            lineHeightCurrentValue={firstTextItem?.lineHeight ?? 1.2}
            textPaddingCurrentValue={firstTextItem?.textPadding ?? 16}
            backgroundRadiusCurrentValue={firstTextItem?.backgroundRadius ?? 0}
            onLineHeightChange={handleLineHeightChange}
            onLineHeightLiveChange={handleLineHeightLiveChange}
            onTextPaddingChange={handleTextPaddingChange}
            onTextPaddingLiveChange={handleTextPaddingLiveChange}
            onBackgroundRadiusChange={handleBackgroundRadiusChange}
            onBackgroundRadiusLiveChange={handleBackgroundRadiusLiveChange}
          />
        </PropertySection>
      )}

      {showEffectSection && (
        <PropertySection title={t('editor.textSection.style')} icon={Palette} defaultOpen={true}>
          <TextEffectsControls
            itemIds={itemIds}
            shadowColor={sharedValues.shadowColor}
            shadowOffsetX={shadowOffsetX}
            shadowOffsetY={shadowOffsetY}
            shadowBlur={shadowBlur}
            strokeWidth={strokeWidth}
            strokeColor={sharedValues.strokeColor}
            shadowOffsetXCurrentValue={firstTextItem?.textShadow?.offsetX ?? 0}
            shadowOffsetYCurrentValue={firstTextItem?.textShadow?.offsetY ?? 0}
            shadowBlurCurrentValue={firstTextItem?.textShadow?.blur ?? 0}
            strokeWidthCurrentValue={firstTextItem?.stroke?.width ?? 0}
            onApplyPreset={handleApplyTextEffectPreset}
            onShadowColorChange={handleShadowColorChange}
            onShadowColorLiveChange={handleShadowColorLiveChange}
            onShadowOffsetXChange={handleShadowOffsetXChange}
            onShadowOffsetXLiveChange={handleShadowOffsetXLiveChange}
            onShadowOffsetYChange={handleShadowOffsetYChange}
            onShadowOffsetYLiveChange={handleShadowOffsetYLiveChange}
            onShadowBlurChange={handleShadowBlurChange}
            onShadowBlurLiveChange={handleShadowBlurLiveChange}
            onStrokeWidthChange={handleStrokeWidthChange}
            onStrokeWidthLiveChange={handleStrokeWidthLiveChange}
            onStrokeColorChange={handleStrokeColorChange}
            onStrokeColorLiveChange={handleStrokeColorLiveChange}
          />
        </PropertySection>
      )}

      {showAnimationSection && (
        <PropertySection
          title={t('textMotion.sectionTitle')}
          icon={WandSparkles}
          defaultOpen={true}
        >
          <div className="flex flex-col gap-2 py-1">
            <p className="text-[10px] leading-snug text-muted-foreground/70">
              {t('textMotion.hint')}
            </p>
            <TextMotionSlotRows items={textItems} />
          </div>
        </PropertySection>
      )}
    </>
  )
}
