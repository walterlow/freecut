import { memo } from 'react';

interface VideoResultPlayerProps {
  url: string;
}

export const VideoResultPlayer = memo(function VideoResultPlayer({
  url,
}: VideoResultPlayerProps) {
  return (
    <video
      src={url}
      className="h-full w-full object-contain"
      controls
      autoPlay
      loop
      playsInline
    />
  );
});
