export interface DirectionalPrewarmOptions {
  forwardSteps?: number;
  backwardSteps?: number;
  oppositeSteps?: number;
  neutralRadius?: number;
}

export function getDirectionalPrewarmOffsets(
  direction: -1 | 0 | 1,
  options: DirectionalPrewarmOptions = {}
): number[] {
  const forwardSteps = Math.max(1, options.forwardSteps ?? 4);
  const backwardSteps = Math.max(1, options.backwardSteps ?? 8);
  const oppositeSteps = Math.max(0, options.oppositeSteps ?? 2);
  const neutralRadius = Math.max(1, options.neutralRadius ?? 2);

  if (direction === 0) {
    const offsets: number[] = [];
    for (let i = 1; i <= neutralRadius; i++) {
      offsets.push(-i, i);
    }
    return offsets;
  }

  const primarySteps = direction < 0 ? backwardSteps : forwardSteps;
  const offsets: number[] = [];
  for (let i = 1; i <= primarySteps; i++) {
    offsets.push(i * direction);
  }
  for (let i = 1; i <= oppositeSteps; i++) {
    offsets.push(-(i * direction));
  }
  return offsets;
}
