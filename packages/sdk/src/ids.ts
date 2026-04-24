import {
  deterministicIds as coreDeterministicIds,
  randomIds as coreRandomIds,
  type IdGenerator,
} from '@freecut/core';

export type { IdGenerator };

export const randomIds: IdGenerator = coreRandomIds;

export function deterministicIds(seed = 0): IdGenerator {
  return coreDeterministicIds(seed);
}
