import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ValueGraphEditor } from './index';
import { DEFAULT_GRAPH_PADDING } from './types';

describe('ValueGraphEditor clipping', () => {
  it('clips graph content to the plotted graph area', () => {
    const { container } = render(
      <TooltipProvider>
        <ValueGraphEditor
          itemId="item-1"
          keyframesByProperty={{
            opacity: [
              {
                id: 'kf-1',
                frame: 0,
                value: 0.5,
                easing: 'linear',
              },
            ],
          }}
          selectedProperty="opacity"
          width={480}
          height={260}
        />
      </TooltipProvider>
    );

    const clipPath = container.querySelector('clipPath');
    expect(clipPath).toBeInTheDocument();

    const clipRect = clipPath?.querySelector('rect');
    expect(clipRect).toHaveAttribute('x', String(DEFAULT_GRAPH_PADDING.left));
    expect(clipRect).toHaveAttribute('y', String(DEFAULT_GRAPH_PADDING.top));

    const clippedGroup = container.querySelector('g[clip-path^="url(#"]');
    expect(clippedGroup).toBeInTheDocument();
    expect(clippedGroup?.querySelector('.graph-keyframes')).toBeInTheDocument();
    expect(clippedGroup?.querySelector('.graph-extension-lines')).toBeInTheDocument();
  });
});
