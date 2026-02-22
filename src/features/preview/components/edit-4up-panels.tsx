import { useEffect, useRef, useState } from 'react';
import type { EditTwoUpPanelData } from './edit-2up-panels';
import {
  VideoFrame,
  ImageFrame,
  TypePlaceholder,
} from './edit-2up-panels';
import type { TimelineItem } from '@/types/timeline';
import {
  getItemAspectRatio,
  computeFittedMediaSize,
  renderPanelMedia,
} from './edit-panel-media-utils';

const TEXT_SPACE = 56;
const GAP = 8;
const CORNER_SCALE = 0.22;

interface EditFourUpPanelsProps {
  leftPanel: EditTwoUpPanelData;
  rightPanel: EditTwoUpPanelData;
  topLeftCorner?: EditTwoUpPanelData;
  topRightCorner?: EditTwoUpPanelData;
}

export function EditFourUpPanels({
  leftPanel,
  rightPanel,
  topLeftCorner,
  topRightCorner,
}: EditFourUpPanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (containerSize.width <= 0 || containerSize.height <= 0) {
    return <div ref={containerRef} className="absolute inset-0 z-30 bg-black" />;
  }

  const panelWidth = Math.max((containerSize.width - GAP) / 2, 1);
  const maxAreaHeight = containerSize.height - TEXT_SPACE;

  const leftNatural = panelWidth / getItemAspectRatio(leftPanel.item);
  const rightNatural = panelWidth / getItemAspectRatio(rightPanel.item);
  const sharedAreaHeight = Math.max(
    1,
    Math.min(Math.max(leftNatural, rightNatural), maxAreaHeight),
  );

  // Corner thumbnail sizing
  const cornerWidth = Math.max(panelWidth * CORNER_SCALE, 1);
  const cornerHeight = Math.max(cornerWidth / (16 / 9), 1);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-30 bg-black flex items-center"
      style={{ gap: GAP }}
    >
      {/* Corner thumbnails - absolutely positioned */}
      {topLeftCorner?.item && (
        <CornerThumbnail
          item={topLeftCorner.item}
          sourceTime={topLeftCorner.sourceTime}
          width={cornerWidth}
          height={cornerHeight}
          position="top-left"
        />
      )}
      {topRightCorner?.item && (
        <CornerThumbnail
          item={topRightCorner.item}
          sourceTime={topRightCorner.sourceTime}
          width={cornerWidth}
          height={cornerHeight}
          position="top-right"
        />
      )}

      {/* Main panels */}
      <MainPanel data={leftPanel} areaHeight={sharedAreaHeight} panelWidth={panelWidth} />
      <MainPanel data={rightPanel} areaHeight={sharedAreaHeight} panelWidth={panelWidth} />
    </div>
  );
}

interface MainPanelProps {
  data: EditTwoUpPanelData;
  areaHeight: number;
  panelWidth: number;
}

function MainPanel({ data, areaHeight, panelWidth }: MainPanelProps) {
  const ar = getItemAspectRatio(data.item);
  const { mediaWidth, mediaHeight } = computeFittedMediaSize(panelWidth, areaHeight, ar);

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center justify-center">
      <span className="text-base font-semibold tracking-widest text-white/80 uppercase pb-1">
        {data.label}
      </span>
      <div
        className="flex items-center justify-center shrink-0 bg-black"
        style={{ width: panelWidth, height: areaHeight }}
      >
        <div
          className="overflow-hidden border border-white/10"
          style={{ width: mediaWidth, height: mediaHeight }}
        >
          {renderPanelMedia(data.item, data.sourceTime, data.placeholderText, {
            renderVideo: (videoItem, time) => <VideoFrame item={videoItem} sourceTime={time} />,
            renderImage: (imageItem) => <ImageFrame item={imageItem} />,
            renderPlaceholder: (type, text) => <TypePlaceholder type={type} text={text} />,
          })}
        </div>
      </div>
      <span className="text-lg font-mono text-white/90 tabular-nums pt-1">{data.timecode}</span>
    </div>
  );
}

interface CornerThumbnailProps {
  item: TimelineItem;
  sourceTime?: number;
  width: number;
  height: number;
  position: 'top-left' | 'top-right';
}

function CornerThumbnail({ item, sourceTime, width, height, position }: CornerThumbnailProps) {
  const isVideo = item.type === 'video';
  const isImage = item.type === 'image';

  const positionClass = position === 'top-left' ? 'left-2 top-2' : 'right-2 top-2';

  return (
    <div
      className={`absolute ${positionClass} z-40 overflow-hidden border border-white/20 rounded-sm shadow-lg`}
      style={{ width, height }}
    >
      {isVideo ? (
        <VideoFrame item={item} sourceTime={sourceTime ?? 0} />
      ) : isImage ? (
        <ImageFrame item={item} />
      ) : (
        <TypePlaceholder type={item.type} text={item.type} />
      )}
    </div>
  );
}
