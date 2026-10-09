import { describe, expect, it, vi } from 'vitest';
import { createLegendFilter } from './legend-filter';

describe('filtro de la leyenda', () => {
  it('todo se ve al empezar y cada toque apaga o enciende una entrada', () => {
    const filter = createLegendFilter<'a' | 'b'>();
    expect(filter.isVisible('a')).toBe(true);

    filter.toggle('a');
    expect(filter.isVisible('a')).toBe(false);
    expect(filter.isVisible('b')).toBe(true);

    filter.toggle('a');
    expect(filter.isVisible('a')).toBe(true);
  });

  it('avisa a quien escucha y deja de avisar al desuscribirse', () => {
    const filter = createLegendFilter<'a'>();
    const listener = vi.fn();
    const unsubscribe = filter.subscribe(listener);

    filter.toggle('a');
    unsubscribe();
    filter.toggle('a');

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
