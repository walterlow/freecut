function randomHex(bytes) {
  const bits = [];
  for (let i = 0; i < bytes; i++) {
    bits.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return bits.join('');
}

export const randomIds = (kind) => `${kind}-${randomHex(8)}`;

export function deterministicIds(seed = 0) {
  const counters = new Map();
  return (kind) => {
    const next = (counters.get(kind) ?? seed) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}
