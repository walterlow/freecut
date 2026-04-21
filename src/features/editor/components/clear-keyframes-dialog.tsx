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
import { useClearKeyframesDialogStore } from '@/app/state/clear-keyframes-dialog';

/**
 * Confirmation dialog for clearing keyframes from selected items.
 * Triggered by Shift+A hotkey or context menu actions.
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
  const itemText = '个片段';
  const propertyLabel = property ? PROPERTY_LABELS[property] : null;

  const title = property ? `清除 ${propertyLabel} 关键帧` : '清除全部关键帧';
  const description = property
    ? `确定要清除 ${itemCount} ${itemText}中的全部 ${propertyLabel} 关键帧吗？`
    : `确定要清除 ${itemCount} ${itemText}中的全部关键帧吗？`;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            <br />
            <span className="text-muted-foreground text-xs mt-1 block">
              此操作可通过 Ctrl+Z 撤销。
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            清除关键帧
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
