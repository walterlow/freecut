import { Button } from '@/components/ui/button';
import {
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
} from 'lucide-react';
import { cn } from '@/shared/ui/cn';

export type AlignmentType =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom';

interface AlignmentButtonsProps {
  onAlign: (alignment: AlignmentType) => void;
  disabled?: boolean;
  className?: string;
}

const horizontalAlignments: Array<{
  type: AlignmentType;
  icon: typeof AlignStartVertical;
  label: string;
}> = [
  { type: 'left', icon: AlignStartVertical, label: 'Align Left' },
  { type: 'center-h', icon: AlignCenterVertical, label: 'Center Horizontally' },
  { type: 'right', icon: AlignEndVertical, label: 'Align Right' },
];

const verticalAlignments: Array<{
  type: AlignmentType;
  icon: typeof AlignStartHorizontal;
  label: string;
}> = [
  { type: 'top', icon: AlignStartHorizontal, label: 'Align Top' },
  { type: 'center-v', icon: AlignCenterHorizontal, label: 'Center Vertically' },
  { type: 'bottom', icon: AlignEndHorizontal, label: 'Align Bottom' },
];

/**
 * Horizontal and vertical alignment button groups.
 * Used to align selected clips to canvas edges or center.
 */
export function AlignmentButtons({
  onAlign,
  disabled = false,
  className,
}: AlignmentButtonsProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Horizontal alignment */}
      <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
        {horizontalAlignments.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onAlign(type)}
            disabled={disabled}
            data-tooltip={label}
            data-tooltip-side="bottom"
          >
            <Icon className="w-3.5 h-3.5" />
          </Button>
        ))}
      </div>

      {/* Vertical alignment */}
      <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
        {verticalAlignments.map(({ type, icon: Icon, label }) => (
          <Button
            key={type}
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onAlign(type)}
            disabled={disabled}
            data-tooltip={label}
            data-tooltip-side="bottom"
          >
            <Icon className="w-3.5 h-3.5" />
          </Button>
        ))}
      </div>
    </div>
  );
}

