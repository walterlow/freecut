export type IdGenerator = (kind: string) => string;

function randomHex(bytes: number): string {
  const bits: string[] = [];
  for (let i = 0; i < bytes; i++) {
    bits.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return bits.join('');
}

export const randomIds: IdGenerator = (kind) => `${kind}-${randomHex(8)}`;

export function deterministicIds(seed = 0): IdGenerator {
  const counters = new Map<string, number>();
  return (kind) => {
    const next = (counters.get(kind) ?? seed) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}
