import type { MotionPathScreenPoint } from '../utils/motion-path'

export interface MotionPathOverlayPath {
  itemId: string
  points: MotionPathScreenPoint[]
}

function buildPathD(points: MotionPathScreenPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.screenX} ${point.screenY}`)
    .join(' ')
}

export function MotionPathOverlay({
  paths,
  width,
  height,
}: {
  paths: MotionPathOverlayPath[]
  width: number
  height: number
}) {
  if (paths.length === 0) return null

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[4]"
      data-testid="motion-path-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {paths.map((path) => (
        <g key={path.itemId}>
          <path
            d={buildPathD(path.points)}
            fill="none"
            stroke="rgba(15, 23, 42, 0.65)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildPathD(path.points)}
            fill="none"
            stroke="rgba(56, 189, 248, 0.88)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {path.points
            .filter((point) => point.isKeyframe)
            .map((point) => (
              <circle
                key={`${path.itemId}:${point.frame}`}
                cx={point.screenX}
                cy={point.screenY}
                r={3.5}
                fill="rgba(250, 204, 21, 0.95)"
                stroke="rgba(15, 23, 42, 0.85)"
                strokeWidth={1.25}
                vectorEffect="non-scaling-stroke"
              />
            ))}
        </g>
      ))}
    </svg>
  )
}
