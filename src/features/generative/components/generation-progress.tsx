import { memo } from 'react';
import { Loader2, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import type { TaskState } from '../types';

interface GenerationProgressProps {
  task: TaskState;
  label: string;
  onCancel: () => void;
}

function statusLabel(status: TaskState['status']): string {
  switch (status) {
    case 'pending':
      return 'Queued...';
    case 'processing':
      return 'Generating...';
    default:
      return 'Working...';
  }
}

export const GenerationProgress = memo(function GenerationProgress({
  task,
  label,
  onCancel,
}: GenerationProgressProps) {
  if (task.status === 'idle' || task.status === 'completed' || task.status === 'cancelled') {
    return null;
  }

  if (task.status === 'failed') {
    return (
      <div className="flex flex-col items-center gap-1 text-xs text-destructive">
        <span>{task.error ?? 'Generation failed'}</span>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {label}: {statusLabel(task.status)} {task.progress > 0 && `${task.progress}%`}
        </span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onCancel}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {task.progress > 0 && (
        <Progress value={task.progress} className="h-1.5 w-full" />
      )}
    </div>
  );
});
