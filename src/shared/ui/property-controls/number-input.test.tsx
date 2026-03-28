import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput } from './number-input';

describe('NumberInput', () => {
  it('normalizes and reflects committed values without a parent rerender', () => {
    const onChange = vi.fn();

    render(
      <NumberInput
        value={5}
        onChange={onChange}
        min={0}
        max={10}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(10);
    expect(input).toHaveValue('10');
  });

  it('supports formatted parse/format input without waiting for a parent rerender', () => {
    const onChange = vi.fn();

    render(
      <NumberInput
        value={5}
        onChange={onChange}
        min={0}
        max={300}
        step={1}
        unit="f"
        formatInputValue={(value) => (value / 30).toFixed(2)}
        parseInputValue={(rawValue) => parseFloat(rawValue) * 30}
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('0.17');

    fireEvent.change(input, { target: { value: '1.00' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(30);
    expect(input).toHaveValue('1.00');
  });
});
