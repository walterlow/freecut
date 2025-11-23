import type { RenderJob, RenderProgress } from '../types.js';

export class JobManager {
  private jobs: Map<string, RenderJob> = new Map();

  /**
   * Create a new render job
   */
  createJob(jobId: string): RenderJob {
    const job: RenderJob = {
      jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date(),
    };

    this.jobs.set(jobId, job);
    console.log(`[JobManager] Created job ${jobId}`);
    return job;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): RenderJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Update job status
   */
  updateJob(jobId: string, update: Partial<RenderJob>): RenderJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const updatedJob = { ...job, ...update };
    this.jobs.set(jobId, updatedJob);

    return updatedJob;
  }

  /**
   * Update job progress
   */
  updateProgress(jobId: string, progress: Partial<RenderProgress>): RenderJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const updatedJob: RenderJob = {
      ...job,
      progress: progress.progress ?? job.progress,
      renderedFrames: progress.renderedFrames ?? job.renderedFrames,
      totalFrames: progress.totalFrames ?? job.totalFrames,
      status: progress.status ?? job.status,
    };

    this.jobs.set(jobId, updatedJob);
    return updatedJob;
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId: string, outputPath: string): RenderJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const updatedJob: RenderJob = {
      ...job,
      status: 'completed',
      progress: 100,
      outputPath,
      completedAt: new Date(),
    };

    this.jobs.set(jobId, updatedJob);
    console.log(`[JobManager] Job ${jobId} completed`);
    return updatedJob;
  }

  /**
   * Mark job as failed
   */
  failJob(jobId: string, error: string): RenderJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const updatedJob: RenderJob = {
      ...job,
      status: 'failed',
      error,
      completedAt: new Date(),
    };

    this.jobs.set(jobId, updatedJob);
    console.error(`[JobManager] Job ${jobId} failed:`, error);
    return updatedJob;
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): RenderJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const updatedJob: RenderJob = {
      ...job,
      status: 'cancelled',
      completedAt: new Date(),
    };

    this.jobs.set(jobId, updatedJob);
    console.log(`[JobManager] Job ${jobId} cancelled`);
    return updatedJob;
  }

  /**
   * Delete a job
   */
  deleteJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (deleted) {
      console.log(`[JobManager] Deleted job ${jobId}`);
    }
    return deleted;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): RenderJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old completed/failed jobs (older than 1 hour)
   */
  cleanupOldJobs(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt &&
        job.completedAt < oneHourAgo
      ) {
        this.jobs.delete(jobId);
        console.log(`[JobManager] Cleaned up old job ${jobId}`);
      }
    }
  }
}

export const jobManager = new JobManager();

// Run cleanup every 30 minutes
setInterval(() => {
  jobManager.cleanupOldJobs();
}, 30 * 60 * 1000);
