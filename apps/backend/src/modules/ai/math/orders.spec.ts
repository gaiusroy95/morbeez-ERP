import { DayOrder, unusualLines, usualOrder } from './orders';

const day = (entries: Record<string, number>): DayOrder => new Map(Object.entries(entries));

describe('a customer’s usual order (requirements Part 14)', () => {
  it('ordered every week, the same things — solid, at the median of what they took', () => {
    const u = usualOrder([day({ tomato: 40, onion: 20 }), day({ tomato: 42, onion: 20 }), day({ tomato: 38, onion: 18 }), day({ tomato: 40, onion: 22 })]);
    expect(u?.confidence).toBe('solid');
    expect(u?.lines).toEqual([
      { productId: 'tomato', quantity: 40, low: 38, high: 42, seen: 4 },
      { productId: 'onion', quantity: 20, low: 18, high: 22, seen: 4 },
    ]);
  });

  it('3 weeks of 4 is enough, as a rough guide; a product taken once is left out', () => {
    const u = usualOrder([day({ tomato: 40, ginger: 2 }), null, day({ tomato: 44 }), day({ tomato: 36, onion: 10 })]);
    expect(u?.confidence).toBe('rough_guide');
    expect(u?.ordered).toBe(3);
    expect(u?.lines.map((l) => l.productId)).toEqual(['tomato']);
  });

  it('2 weeks of 4 is no pattern', () => {
    expect(usualOrder([day({ tomato: 40 }), null, day({ tomato: 40 }), null])).toBeNull();
  });
});

describe('an unusual order', () => {
  const past = [day({ tomato: 200, onion: 30 }), day({ tomato: 180, onion: 25 }), day({ tomato: 220, onion: 30 }), day({ tomato: 210, onion: 28 })];

  it('“usually 180–220 kg, ordered only 60”', () => {
    expect(unusualLines(day({ tomato: 60, onion: 30 }), past)).toEqual([{ productId: 'tomato', kind: 'low', quantity: 60, low: 180, high: 220, usual: 205 }]);
  });

  it('more than twice their most', () => {
    expect(unusualLines(day({ tomato: 500, onion: 30 }), past)[0]).toMatchObject({ kind: 'high', quantity: 500 });
  });

  it('a product they take every time, missing', () => {
    expect(unusualLines(day({ tomato: 200 }), past)).toEqual([{ productId: 'onion', kind: 'missing', quantity: 0, low: 25, high: 30, usual: 29 }]);
  });

  it('within their usual range — nothing; under three past orders — no judgement', () => {
    expect(unusualLines(day({ tomato: 150, onion: 20 }), past)).toEqual([]);
    expect(unusualLines(day({ tomato: 10 }), past.slice(0, 2))).toEqual([]);
  });
});
