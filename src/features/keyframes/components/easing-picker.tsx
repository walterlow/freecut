/**
 * Easing picker dropdown for selecting keyframe easing types.
 * Includes visual previews of the easing curves.
 */

import { memo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EasingType } from '@/types/keyframe';
import { EASING_LABELS, BASIC_EASING_TYPES } from '@/types/keyframe';

interface EasingPickerProps {
  /** Current easing value */
  value: EasingType;
  /** Callback when easing changes */
  onChange: (value: EasingType) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Additional class name for the trigger */
  className?: string;
}

/**
 * SVG path data for easing curve visualizations.
 * Each curve is drawn in a 24x24 viewBox from (2,20) to (22,4).
 */
const EASING_CURVES: Record<EasingType, string> = {
  'linear': 'M2,20 L22,4',
  'ease-in': 'M2,20 Q2,4 22,4',
  'ease-out': 'M2,20 Q22,20 22,4',
  'ease-in-out': 'M2,20 C2,12 22,12 22,4',
  'cubic-bezier': 'M2,20 C6,20 18,4 22,4',
  'spring': 'M2,20 C4,8 8,2 12,6 C16,10 18,3 22,4',
};

/**
 * Small SVG visualization of an easing curve.
 */
const EasingCurve = memo(function EasingCurve({ type }: { type: EasingType }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
    >
      {/* Grid background */}
      <rect
        x="2"
        y="4"
        width="20"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.1"
        strokeWidth="0.5"
      />
      {/* Easing curve */}
      <path
        d={EASING_CURVES[type]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
});

/**
 * Dropdown picker for selecting keyframe easing types.
 * Shows current easing with visual curve preview.
 */
export const EasingPicker = memo(function EasingPicker({
  value,
  onChange,
  disabled = false,
  className,
}: EasingPickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as EasingType)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue>
          <span className="flex items-center gap-2">
            <EasingCurve type={value} />
            <span>{EASING_LABELS[value]}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BASIC_EASING_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            <span className="flex items-center gap-2">
              <EasingCurve type={type} />
              <span>{EASING_LABELS[type]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

/**
 * Compact easing picker for use in keyframe lane context menus.
 * Shows only the curve icon in the trigger.
 */
export const CompactEasingPicker = memo(function CompactEasingPicker({
  value,
  onChange,
  disabled = false,
}: Omit<EasingPickerProps, 'className'>) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as EasingType)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[32px] h-[24px] px-1">
        <SelectValue>
          <EasingCurve type={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {BASIC_EASING_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            <span className="flex items-center gap-2">
              <EasingCurve type={type} />
              <span>{EASING_LABELS[type]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});
