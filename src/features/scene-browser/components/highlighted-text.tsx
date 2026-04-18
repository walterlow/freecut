import { memo } from 'react';

interface HighlightedTextProps {
  text: string;
  /** Sorted, non-overlapping ranges (output of `findMatchSpans`). */
  spans: Array<[number, number]>;
  className?: string;
}

/**
 * Render `text` with `<mark/>` wrappers around each match span. Assumes
 * spans are sorted and non-overlapping — rank.ts merges overlaps before
 * returning them.
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  spans,
  className,
}: HighlightedTextProps) {
  if (spans.length === 0) {
    return <span className={className}>{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    const [from, to] = span;
    if (from > cursor) parts.push(text.slice(cursor, from));
    parts.push(
      <mark
        key={`${from}-${to}-${index}`}
        className="bg-primary/25 text-foreground rounded-sm px-0.5 -mx-0.5"
      >
        {text.slice(from, to)}
      </mark>,
    );
    cursor = to;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={className}>{parts}</span>;
});
