import type { TextItem, TextSpan } from '@/types/timeline';

export function getTextItemSpans(
  item: Pick<TextItem, 'text' | 'textSpans'>,
): TextSpan[] {
  if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
    const spans = item.textSpans
      .filter((span) => typeof span.text === 'string')
      .map((span) => ({ ...span }));
    if (spans.length > 0) {
      return spans;
    }
  }

  return [{ text: item.text ?? '' }];
}

export function getTextItemPlainText(
  item: Pick<TextItem, 'text' | 'textSpans'>,
): string {
  const spans = getTextItemSpans(item);
  return spans.map((span) => span.text).join('\n');
}

export function getTextItemPrimaryText(
  item: Pick<TextItem, 'text' | 'textSpans'>,
): string {
  if (Array.isArray(item.textSpans) && item.textSpans.length > 0) {
    return item.textSpans[0]?.text ?? '';
  }

  return (item.text ?? '').split('\n')[0] ?? '';
}

export function buildTextItemLabelFromText(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  return firstLine || 'Text';
}
