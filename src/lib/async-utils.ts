import { createLogger } from '@/lib/logger';

const logger = createLogger('AsyncUtils');

export async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>
): Promise<Array<U | null>> {
  const results: Array<U | null> = new Array(items.length).fill(null);
  const safeConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : 1;
  const workerCount = Math.max(1, Math.min(safeConcurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= items.length) return;
        try {
          const mappedValue = await mapper(items[currentIndex]!, currentIndex);
          results[currentIndex] = mappedValue;
        } catch (error) {
          logger.warn('mapWithConcurrency mapper failed', {
            index: currentIndex,
            error,
          });
          results[currentIndex] = null;
        }
      }
    })
  );

  return results;
}
