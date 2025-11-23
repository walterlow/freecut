import { Composition, registerRoot } from 'remotion';
import { MainComposition } from './compositions/main-composition';
import type { RemotionInputProps } from '@/types/export';

export const RemotionRoot = () => {
  return (
    <>
      <Composition<RemotionInputProps>
        id="MainComposition"
        component={MainComposition}
        // Default values (will be overridden by inputProps during render)
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        // Calculate metadata dynamically from inputProps
        calculateMetadata={({ props }) => {
          return {
            durationInFrames: props.durationInFrames,
            fps: props.fps,
            width: props.width,
            height: props.height,
          };
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
