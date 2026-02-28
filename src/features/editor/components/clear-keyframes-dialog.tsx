import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTimelineStore } from '@/features/editor/deps/timeline-store';
import { PROPERTY_LABELS } from '@/types/keyframe';
import { useClearKeyframesDialogStore } from '@/shared/state/clear-keyframes-dialog';

/**
 * Confirmation dialog for clearing keyframes from selected items.
 * Triggered by Shift+K hotkey or context menu actions.
 */
export function ClearKeyframesDialog() {
  const isOpen = useClearKeyframesDialogStore((s) => s.isOpen);
  const itemIds = useClearKeyframesDialogStore((s) => s.itemIds);
  const property = useClearKeyframesDialogStore((s) => s.property);
  const close = useClearKeyframesDialogStore((s) => s.close);

  const handleConfirm = () => {
    if (property) {
      // Clear keyframes for specific property
      const removeKeyframesForProperty = useTimelineStore.getState().removeKeyframesForProperty;
      for (const itemId of itemIds) {
        removeKeyframesForProperty(itemId, property);
      }
    } else {
      // Clear all keyframes
      const removeKeyframesForItem = useTimelineStore.getState().removeKeyframesForItem;
      for (const itemId of itemIds) {
        removeKeyframesForItem(itemId);
      }
    }
    close();
  };

  const itemCount = itemIds.length;
  const itemText = itemCount === 1 ? 'clip' : 'clips';
  const propertyLabel = property ? PROPERTY_LABELS[property] : null;

  const title = property ? `Clear ${propertyLabel} Keyframes` : 'Clear All Keyframes';
  const description = property
    ? `Are you sure you want to clear all ${propertyLabel} keyframes from ${itemCount} ${itemText}?`
    : `Are you sure you want to clear all keyframes from ${itemCount} ${itemText}?`;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            <br />
            <span className="text-muted-foreground text-xs mt-1 block">
              This action can be undone with Ctrl+Z.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            Clear Keyframes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

