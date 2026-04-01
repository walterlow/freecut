import { useProjectMediaMatchDialogStore } from '@/shared/state/project-media-match-dialog';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import {
  getMimeType,
  mediaProcessorService,
  type ExtractedMediaFileEntry,
} from '@/features/timeline/deps/media-library-resolver';

export async function preflightFirstTimelineVideoProjectMatch(
  entries: ExtractedMediaFileEntry[]
): Promise<void> {
  const currentProjectId = useMediaLibraryStore.getState().currentProjectId;
  if (!currentProjectId) {
    return;
  }

  const hasExistingProjectVideo = useMediaLibraryStore
    .getState()
    .mediaItems
    .some((item) => item.mimeType.startsWith('video/'));
  if (hasExistingProjectVideo) {
    return;
  }

  const firstVideoEntry = entries.find((entry) => entry.mediaType === 'video');
  if (!firstVideoEntry) {
    return;
  }

  const mimeType = getMimeType(firstVideoEntry.file);
  const { metadata } = await mediaProcessorService.processMedia(firstVideoEntry.file, mimeType, {
    generateThumbnail: false,
  });

  if (metadata.type !== 'video') {
    throw new Error('Unable to inspect dropped video.');
  }

  await useProjectMediaMatchDialogStore.getState().requestProjectMediaMatch(currentProjectId, {
    fileName: firstVideoEntry.file.name,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
  });
}
