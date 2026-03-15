import { useMemo } from 'react';
import { Cpu, Loader2 } from 'lucide-react';
import {
  formatEstimatedBytes,
  getLocalInferenceSummary,
  useLocalInferenceStore,
} from '@/shared/state/local-inference';

function getStateLabel(state: 'loading' | 'running' | 'ready' | 'error'): string {
  switch (state) {
    case 'loading':
      return 'Local AI Loading';
    case 'running':
      return 'Local AI Active';
    case 'error':
      return 'Local AI Error';
    case 'ready':
      return 'Local AI Ready';
  }
}

export function LocalInferenceStatusPill() {
  const runtimesById = useLocalInferenceStore((state) => state.runtimesById);
  const summary = useMemo(() => getLocalInferenceSummary(runtimesById), [runtimesById]);

  if (!summary) {
    return null;
  }

  const estimateLabel = formatEstimatedBytes(summary.totalEstimatedBytes);
  const detailParts = [
    summary.primaryLabel,
    summary.backendLabel,
    summary.activeJobs > 0 ? `${summary.activeJobs} job${summary.activeJobs === 1 ? '' : 's'}` : null,
    estimateLabel,
  ].filter(Boolean);

  return (
    <div className="hidden items-center gap-2 rounded-md border border-border/70 bg-secondary/35 px-2.5 py-1 lg:flex">
      {summary.state === 'loading' || summary.state === 'running' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />
      ) : (
        <Cpu className="h-3.5 w-3.5 text-orange-500" />
      )}
      <div className="min-w-0">
        <div className="text-[10px] font-medium leading-none">
          {getStateLabel(summary.state)}
        </div>
        <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
          {detailParts.join(' | ')}
        </div>
      </div>
    </div>
  );
}
