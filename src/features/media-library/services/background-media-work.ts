import { createLogger } from '@/shared/logging/logger';
import { schedulePreviewWork } from '@/features/media-library/deps/timeline-services';

const logger = createLogger('BackgroundMediaWork');

type BackgroundMediaWorkPriority = 'warm' | 'heavy';

interface BackgroundMediaWorkOptions {
  delayMs?: number;
  priority?: BackgroundMediaWorkPriority;
}

interface BackgroundMediaWorkJob {
  id: number;
  sequence: number;
  readyAtMs: number;
  priority: 0 | 1;
  run: () => void | Promise<void>;
}

const MAX_CONCURRENT_BACKGROUND_MEDIA_JOBS = 1;

let nextBackgroundMediaJobId = 1;
let nextBackgroundMediaSequence = 1;
let activeBackgroundMediaJobs = 0;
let scheduledJobId: number | null = null;
let cancelScheduledJob = () => {};
const backgroundMediaQueue: BackgroundMediaWorkJob[] = [];

function sortBackgroundMediaQueue(): void {
  backgroundMediaQueue.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    if (left.readyAtMs !== right.readyAtMs) {
      return left.readyAtMs - right.readyAtMs;
    }
    return left.sequence - right.sequence;
  });
}

function cancelScheduledPump(): void {
  cancelScheduledJob();
  cancelScheduledJob = () => {};
  scheduledJobId = null;
}

function startBackgroundMediaJob(jobId: number): void {
  scheduledJobId = null;
  cancelScheduledJob = () => {};

  if (activeBackgroundMediaJobs >= MAX_CONCURRENT_BACKGROUND_MEDIA_JOBS) {
    pumpBackgroundMediaQueue();
    return;
  }

  const jobIndex = backgroundMediaQueue.findIndex((job) => job.id === jobId);
  if (jobIndex === -1) {
    pumpBackgroundMediaQueue();
    return;
  }

  const [job] = backgroundMediaQueue.splice(jobIndex, 1);
  if (!job) {
    pumpBackgroundMediaQueue();
    return;
  }

  activeBackgroundMediaJobs += 1;
  void Promise.resolve()
    .then(job.run)
    .catch((error) => {
      logger.warn('Background media work failed:', error);
    })
    .finally(() => {
      activeBackgroundMediaJobs = Math.max(0, activeBackgroundMediaJobs - 1);
      pumpBackgroundMediaQueue();
    });
}

function pumpBackgroundMediaQueue(): void {
  cancelScheduledPump();

  if (activeBackgroundMediaJobs >= MAX_CONCURRENT_BACKGROUND_MEDIA_JOBS) {
    return;
  }

  if (backgroundMediaQueue.length === 0) {
    return;
  }

  sortBackgroundMediaQueue();
  const nextJob = backgroundMediaQueue[0];
  if (!nextJob) {
    return;
  }

  const delayMs = Math.max(0, nextJob.readyAtMs - Date.now());
  scheduledJobId = nextJob.id;
  cancelScheduledJob = schedulePreviewWork(() => {
    startBackgroundMediaJob(nextJob.id);
  }, { delayMs });
}

export function enqueueBackgroundMediaWork(
  run: () => void | Promise<void>,
  options: BackgroundMediaWorkOptions = {},
): () => void {
  const jobId = nextBackgroundMediaJobId++;
  const priority = options.priority === 'heavy' ? 1 : 0;
  backgroundMediaQueue.push({
    id: jobId,
    sequence: nextBackgroundMediaSequence++,
    readyAtMs: Date.now() + Math.max(0, options.delayMs ?? 0),
    priority,
    run,
  });
  pumpBackgroundMediaQueue();

  return () => {
    const queueIndex = backgroundMediaQueue.findIndex((job) => job.id === jobId);
    if (queueIndex !== -1) {
      backgroundMediaQueue.splice(queueIndex, 1);
    }

    if (scheduledJobId === jobId) {
      cancelScheduledPump();
      pumpBackgroundMediaQueue();
    }
  };
}

export function _resetBackgroundMediaWorkForTest(): void {
  backgroundMediaQueue.splice(0, backgroundMediaQueue.length);
  activeBackgroundMediaJobs = 0;
  nextBackgroundMediaJobId = 1;
  nextBackgroundMediaSequence = 1;
  cancelScheduledPump();
}
