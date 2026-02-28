import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Type, AlignLeft, AlignCenter, AlignRight, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TextItem, TimelineItem } from '@/types/timeline';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { useGizmoStore } from '@/features/editor/deps/preview';
import {
  PropertySection,
  PropertyRow,
  NumberInput,
  ColorPicker,
} from '../components';
import { FontPicker } from './font-picker';
import { FONT_CATALOG, FONT_WEIGHT_MAP } from '@/shared/typography/fonts';

const FONT_WEIGHT_OPTIONS = [
  { value: 'normal', label: 'Regular' },
  { value: 'medium', label: 'Medium' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
] as const;

const FONT_WEIGHT_VALUES = FONT_WEIGHT_MAP as Record<NonNullable<TextItem['fontWeight']>, number>;


interface TextSectionProps {
  items: TimelineItem[];
}

/**
 * Text section - properties for text items (font, color, alignment, etc.)
 */
export function TextSection({ items }: TextSectionProps) {
  const updateItem = useTimelineStore((s) => s.updateItem);

  // Gizmo store for live fontSize preview
  const setPropertiesPreviewNew = useGizmoStore((s) => s.setPropertiesPreviewNew);
  const clearPreview = useGizmoStore((s) => s.clearPreview);

  // Filter to only text items
  const textItems = useMemo(
    () => items.filter((item): item is TextItem => item.type === 'text'),
    [items]
  );

  // Memoize item IDs for stable callback dependencies
  const itemIds = useMemo(() => textItems.map((item) => item.id), [textItems]);

  // Get shared values across selected text items
  const sharedValues = useMemo(() => {
    if (textItems.length === 0) return null;

    const first = textItems[0]!;
    return {
      text: textItems.every(i => i.text === first.text) ? first.text : undefined,
      fontSize: textItems.every(i => (i.fontSize ?? 60) === (first.fontSize ?? 60)) ? (first.fontSize ?? 60) : 'mixed' as const,
      fontFamily: textItems.every(i => (i.fontFamily ?? 'Inter') === (first.fontFamily ?? 'Inter')) ? (first.fontFamily ?? 'Inter') : undefined,
      fontWeight: textItems.every(i => (i.fontWeight ?? 'normal') === (first.fontWeight ?? 'normal')) ? (first.fontWeight ?? 'normal') : undefined,
      color: textItems.every(i => i.color === first.color) ? first.color : undefined,
      textAlign: textItems.every(i => (i.textAlign ?? 'center') === (first.textAlign ?? 'center')) ? (first.textAlign ?? 'center') : undefined,
      verticalAlign: textItems.every(i => (i.verticalAlign ?? 'middle') === (first.verticalAlign ?? 'middle')) ? (first.verticalAlign ?? 'middle') : undefined,
      letterSpacing: textItems.every(i => (i.letterSpacing ?? 0) === (first.letterSpacing ?? 0)) ? (first.letterSpacing ?? 0) : 'mixed' as const,
      lineHeight: textItems.every(i => (i.lineHeight ?? 1.2) === (first.lineHeight ?? 1.2)) ? (first.lineHeight ?? 1.2) : 'mixed' as const,
    };
  }, [textItems]);

  const supportedFontWeightOptions = useMemo(() => {
    const selectedFontFamily = sharedValues?.fontFamily;
    if (!selectedFontFamily) {
      return FONT_WEIGHT_OPTIONS;
    }

    const selectedFont = FONT_CATALOG.find(
      (font) => font.family === selectedFontFamily || font.value === selectedFontFamily
    );
    if (!selectedFont) {
      return FONT_WEIGHT_OPTIONS;
    }

    const options = FONT_WEIGHT_OPTIONS.filter((weight) =>
      selectedFont.weights.includes(FONT_WEIGHT_VALUES[weight.value])
    );

    return options.length > 0 ? options : FONT_WEIGHT_OPTIONS;
  }, [sharedValues?.fontFamily]);

  const previousFontFamilyRef = useRef<string | undefined>(sharedValues?.fontFamily);
  const sharedFontWeightRef = useRef<TextItem['fontWeight'] | undefined>(sharedValues?.fontWeight);
  sharedFontWeightRef.current = sharedValues?.fontWeight;

  // Update all selected text items
  const updateTextItems = useCallback(
    (updates: Partial<TextItem>) => {
      textItems.forEach((item) => {
        updateItem(item.id, updates);
      });
    },
    [textItems, updateItem]
  );

  // Handlers
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      textItems.forEach((item) => {
        updateItem(item.id, { text: newText, label: newText.split('\n')[0] || 'Text' });
      });
    },
    [textItems, updateItem]
  );

  // Live preview for fontSize (during drag)
  const handleFontSizeLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { fontSize: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { fontSize: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit fontSize (on mouse up)
  const handleFontSizeChange = useCallback(
    (value: number) => {
      updateTextItems({ fontSize: value });
      queueMicrotask(() => clearPreview());
    },
    [updateTextItems, clearPreview]
  );

  const handleFontFamilyChange = useCallback(
    (value: string) => {
      updateTextItems({ fontFamily: value });
    },
    [updateTextItems]
  );

  const handleFontWeightChange = useCallback(
    (value: string) => {
      if (!supportedFontWeightOptions.some((weight) => weight.value === value)) {
        return;
      }
      updateTextItems({ fontWeight: value as TextItem['fontWeight'] });
    },
    [supportedFontWeightOptions, updateTextItems]
  );

  useEffect(() => {
    const currentFontFamily = sharedValues?.fontFamily;
    if (previousFontFamilyRef.current === currentFontFamily) {
      return;
    }

    previousFontFamilyRef.current = currentFontFamily;

    const currentWeight = sharedFontWeightRef.current;
    if (!currentWeight) {
      return;
    }

    if (supportedFontWeightOptions.some((weight) => weight.value === currentWeight)) {
      return;
    }

    const fallbackWeight = supportedFontWeightOptions[0]?.value;
    if (!fallbackWeight) {
      return;
    }

    updateTextItems({ fontWeight: fallbackWeight });
  }, [sharedValues?.fontFamily, supportedFontWeightOptions, updateTextItems]);

  // Live preview for color (during picker drag)
  const handleColorLiveChange = useCallback(
    (value: string) => {
      const previews: Record<string, { color: string }> = {};
      itemIds.forEach((id) => {
        previews[id] = { color: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit color (on picker close)
  const handleColorChange = useCallback(
    (value: string) => {
      updateTextItems({ color: value });
      queueMicrotask(() => clearPreview());
    },
    [updateTextItems, clearPreview]
  );

  const handleTextAlignChange = useCallback(
    (value: string) => {
      updateTextItems({ textAlign: value as TextItem['textAlign'] });
    },
    [updateTextItems]
  );

  const handleVerticalAlignChange = useCallback(
    (value: string) => {
      updateTextItems({ verticalAlign: value as TextItem['verticalAlign'] });
    },
    [updateTextItems]
  );

  // Live preview for letterSpacing (during drag)
  const handleLetterSpacingLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { letterSpacing: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { letterSpacing: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit letterSpacing (on mouse up)
  const handleLetterSpacingChange = useCallback(
    (value: number) => {
      updateTextItems({ letterSpacing: value });
      queueMicrotask(() => clearPreview());
    },
    [updateTextItems, clearPreview]
  );

  // Live preview for lineHeight (during drag)
  const handleLineHeightLiveChange = useCallback(
    (value: number) => {
      const previews: Record<string, { lineHeight: number }> = {};
      itemIds.forEach((id) => {
        previews[id] = { lineHeight: value };
      });
      setPropertiesPreviewNew(previews);
    },
    [itemIds, setPropertiesPreviewNew]
  );

  // Commit lineHeight (on mouse up)
  const handleLineHeightChange = useCallback(
    (value: number) => {
      updateTextItems({ lineHeight: value });
      queueMicrotask(() => clearPreview());
    },
    [updateTextItems, clearPreview]
  );

  if (textItems.length === 0 || !sharedValues) {
    return null;
  }

  const fontPreviewText = sharedValues.text ?? textItems[0]?.text ?? '';

  return (
    <PropertySection title="Text" icon={Type} defaultOpen={true}>
      {/* Text Content */}
      <PropertyRow label="Content">
        <Textarea
          value={sharedValues.text ?? ''}
          onChange={handleTextChange}
          placeholder={sharedValues.text === undefined ? 'Mixed' : 'Enter text...'}
          className="min-h-[60px] text-xs flex-1 min-w-0"
          rows={3}
        />
      </PropertyRow>

      {/* Font Family */}
      <PropertyRow label="Font" className="items-start">
        <FontPicker
          value={sharedValues.fontFamily}
          placeholder={sharedValues.fontFamily === undefined ? 'Mixed' : 'Select font'}
          previewText={fontPreviewText}
          onValueChange={handleFontFamilyChange}
        />
      </PropertyRow>

      {/* Font Size */}
      <PropertyRow label="Size">
        <NumberInput
          value={sharedValues.fontSize}
          onChange={handleFontSizeChange}
          onLiveChange={handleFontSizeLiveChange}
          min={8}
          max={500}
          step={1}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      {/* Font Weight */}
      <PropertyRow label="Weight">
        <Select
          value={sharedValues.fontWeight}
          onValueChange={handleFontWeightChange}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue placeholder={sharedValues.fontWeight === undefined ? 'Mixed' : 'Select weight'} />
          </SelectTrigger>
          <SelectContent>
            {supportedFontWeightOptions.map((weight) => (
              <SelectItem key={weight.value} value={weight.value} className="text-xs">
                {weight.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>

      {/* Text Align */}
      <PropertyRow label="Align">
        <div className="flex gap-1">
          <Button
            variant={sharedValues.textAlign === 'left' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTextAlignChange('left')}
            title="Align Left"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={sharedValues.textAlign === 'center' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTextAlignChange('center')}
            title="Align Center"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={sharedValues.textAlign === 'right' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleTextAlignChange('right')}
            title="Align Right"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant={sharedValues.verticalAlign === 'top' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleVerticalAlignChange('top')}
            title="Align Top"
          >
            <AlignStartHorizontal className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={sharedValues.verticalAlign === 'middle' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleVerticalAlignChange('middle')}
            title="Align Middle"
          >
            <AlignCenterHorizontal className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={sharedValues.verticalAlign === 'bottom' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => handleVerticalAlignChange('bottom')}
            title="Align Bottom"
          >
            <AlignEndHorizontal className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      {/* Text Color */}
      <ColorPicker
        label="Color"
        color={sharedValues.color ?? '#ffffff'}
        onChange={handleColorChange}
        onLiveChange={handleColorLiveChange}
        onReset={() => handleColorChange('#ffffff')}
        defaultColor="#ffffff"
      />

      {/* Letter Spacing */}
      <PropertyRow label="Spacing">
        <NumberInput
          value={sharedValues.letterSpacing}
          onChange={handleLetterSpacingChange}
          onLiveChange={handleLetterSpacingLiveChange}
          min={-20}
          max={100}
          step={1}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      {/* Line Height */}
      <PropertyRow label="Line H.">
        <NumberInput
          value={sharedValues.lineHeight}
          onChange={handleLineHeightChange}
          onLiveChange={handleLineHeightLiveChange}
          min={0.5}
          max={3}
          step={0.1}
          className="flex-1 min-w-0"
        />
      </PropertyRow>
    </PropertySection>
  );
}


