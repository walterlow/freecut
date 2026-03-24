import type { TimelineItem, VideoItem, AudioItem } from '@/types/timeline';

export type AudioCapableItem = VideoItem | AudioItem;

export function getAudioSectionItems(items: TimelineItem[]): AudioCapableItem[] {
  const selectedAudioItems = items.filter(
    (item): item is AudioItem => item.type === 'audio'
  );

  if (selectedAudioItems.length > 0) {
    return selectedAudioItems;
  }

  return items.filter(
    (item): item is AudioCapableItem => item.type === 'video' || item.type === 'audio'
  );
}
