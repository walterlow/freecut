import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temp', 'media');

export class MediaService {
  /**
   * Save uploaded media file to temp directory for a specific job
   */
  async saveMediaFile(jobId: string, mediaId: string, buffer: Buffer, filename: string): Promise<string> {
    const jobDir = path.join(TEMP_DIR, jobId);

    // Create job directory if it doesn't exist
    await fs.mkdir(jobDir, { recursive: true });

    // Save file with original extension
    const ext = path.extname(filename) || '.bin';
    const filePath = path.join(jobDir, `${mediaId}${ext}`);

    await fs.writeFile(filePath, buffer);

    console.log(`[MediaService] Saved media file: ${mediaId} for job ${jobId}`);
    return filePath;
  }

  /**
   * Get file path for a media ID in a job
   */
  getMediaPath(jobId: string, mediaId: string, extension: string): string {
    return path.join(TEMP_DIR, jobId, `${mediaId}${extension}`);
  }

  /**
   * Clean up media files for a job
   */
  async cleanupJob(jobId: string): Promise<void> {
    const jobDir = path.join(TEMP_DIR, jobId);

    try {
      await fs.rm(jobDir, { recursive: true, force: true });
      console.log(`[MediaService] Cleaned up media for job ${jobId}`);
    } catch (error) {
      console.error(`[MediaService] Error cleaning up job ${jobId}:`, error);
    }
  }

  /**
   * List all media files for a job
   */
  async listMediaFiles(jobId: string): Promise<string[]> {
    const jobDir = path.join(TEMP_DIR, jobId);

    try {
      const files = await fs.readdir(jobDir);
      return files;
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if media file exists
   */
  async mediaExists(jobId: string, mediaId: string, extension: string): Promise<boolean> {
    const filePath = this.getMediaPath(jobId, mediaId, extension);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const mediaService = new MediaService();
