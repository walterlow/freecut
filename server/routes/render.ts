import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import type { RenderRequest } from '../types.js';
import { jobManager } from '../services/job-manager.js';
import { mediaService } from '../services/media-service.js';
import { renderService } from '../services/render-service.js';
import fs from 'fs';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5000 * 1024 * 1024, // 5000MB max file size
    files: 100, // Allow up to 100 files
    fields: 100, // Allow up to 100 fields
  },
});

/**
 * POST /api/render
 * Start a new render job
 */
router.post('/render', async (req: Request, res: Response) => {
  try {
    const renderRequest: RenderRequest = req.body;

    // Generate job ID if not provided
    const jobId = renderRequest.jobId || randomUUID();

    // Create job
    jobManager.createJob(jobId);

    // Respond immediately with job ID
    res.json({
      success: true,
      jobId,
      status: 'pending',
    });

    // Start render in background
    renderService.startRender({
      ...renderRequest,
      jobId,
    }).catch((error) => {
      console.error(`[API] Error starting render for job ${jobId}:`, error);
      jobManager.failJob(jobId, error.message || String(error));
    });
  } catch (error: any) {
    console.error('[API] Error in /render:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to start render',
    });
  }
});

/**
 * GET /api/render/:jobId/status
 * Get status of a render job
 */
router.get('/render/:jobId/status', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  res.json({
    success: true,
    job: {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      renderedFrames: job.renderedFrames,
      totalFrames: job.totalFrames,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    },
  });
});

/**
 * DELETE /api/render/:jobId
 * Cancel a render job
 */
router.delete('/render/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  // Try to cancel if actively rendering
  const cancelled = renderService.cancelRender(jobId);

  // Update job status
  if (cancelled) {
    jobManager.cancelJob(jobId);
  }

  res.json({
    success: true,
    cancelled,
    status: job.status,
  });
});

/**
 * POST /api/media/upload
 * Upload media files for a job
 *
 * Using upload.any() to accept files with any field name (media-{mediaId})
 */
router.post('/media/upload', (req, res, next) => {
  const uploadHandler = upload.any();
  uploadHandler(req, res, (err) => {
    if (err) {
      console.error('[API] Multer error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'File upload failed',
      });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'jobId is required',
      });
    }

    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded',
      });
    }

    // Update job status
    jobManager.updateJob(jobId, { status: 'uploading' });

    // Save all files
    const uploadedFiles: string[] = [];

    for (const file of files) {
      // Extract mediaId from fieldname (should be like "media-{mediaId}")
      const mediaId = file.fieldname.replace('media-', '');

      const filePath = await mediaService.saveMediaFile(jobId, mediaId, file.buffer, file.originalname);

      uploadedFiles.push(filePath);
    }

    console.log(`[API] Uploaded ${uploadedFiles.length} files for job ${jobId}`);

    res.json({
      success: true,
      filesUploaded: uploadedFiles.length,
    });
  } catch (error: any) {
    console.error('[API] Error in /media/upload:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to upload files',
    });
  }
});

/**
 * GET /api/media/:jobId/:mediaId
 * Serve uploaded media file for rendering
 */
router.get('/media/:jobId/:mediaId', async (req: Request, res: Response) => {
  const { jobId, mediaId } = req.params;

  try {
    // List files in job directory to find the right file
    const files = await mediaService.listMediaFiles(jobId);
    const mediaFile = files.find((f) => f.startsWith(mediaId));

    if (!mediaFile) {
      return res.status(404).json({
        success: false,
        error: 'Media file not found',
      });
    }

    // Get full path
    const ext = mediaFile.substring(mediaId.length);
    const filePath = mediaService.getMediaPath(jobId, mediaId, ext);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);

    // Set appropriate content type based on extension
    const contentTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
    };

    const contentType = contentTypes[ext.toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error(`[API] Error streaming media ${mediaId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Failed to stream media file',
        });
      }
    });
  } catch (error: any) {
    console.error('[API] Error in /media/:jobId/:mediaId:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to serve media file',
    });
  }
});

/**
 * GET /api/render/:jobId/download
 * Download rendered video
 */
router.get('/render/:jobId/download', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = jobManager.getJob(jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: `Job is not completed. Current status: ${job.status}`,
    });
  }

  if (!job.outputPath) {
    return res.status(404).json({
      success: false,
      error: 'Output file not found',
    });
  }

  // Check if file exists
  const exists = await renderService.outputExists(jobId);
  if (!exists) {
    return res.status(404).json({
      success: false,
      error: 'Output file not found on disk',
    });
  }

  // Stream the file
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${jobId}.mp4"`);

  const fileStream = fs.createReadStream(job.outputPath);
  fileStream.pipe(res);

  fileStream.on('error', (error) => {
    console.error(`[API] Error streaming file for job ${jobId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to stream video file',
      });
    }
  });
});

export default router;
