import { describe, expect, it } from 'vitest';
import {
  buildTextItemLabelFromText,
  getTextItemPrimaryText,
  getTextItemPlainText,
  getTextItemSpans,
} from './text-item-spans';

describe('text-item-spans', () => {
  it('falls back to the legacy text field when no spans exist', () => {
    expect(getTextItemSpans({ text: 'Hello world' })).toEqual([
      { text: 'Hello world' },
    ]);
    expect(getTextItemPlainText({ text: 'Hello world' })).toBe('Hello world');
  });

  it('joins span text into plain text in order', () => {
    expect(getTextItemPlainText({
      text: 'Ignored',
      textSpans: [
        { text: 'Headline' },
        { text: 'Subtitle' },
      ],
    })).toBe('Headline\nSubtitle');
  });

  it('returns the primary text for layout switching', () => {
    expect(getTextItemPrimaryText({
      text: 'Headline\nSubtitle',
    })).toBe('Headline');

    expect(getTextItemPrimaryText({
      text: 'Ignored',
      textSpans: [
        { text: 'Tag' },
        { text: 'Headline' },
      ],
    })).toBe('Tag');
  });

  it('builds a label from the first non-empty line', () => {
    expect(buildTextItemLabelFromText('Headline\nSubtitle')).toBe('Headline');
    expect(buildTextItemLabelFromText('   \nSubtitle')).toBe('Text');
  });
});
