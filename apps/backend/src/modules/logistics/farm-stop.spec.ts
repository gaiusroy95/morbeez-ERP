import { farmLinesOf, loadedKgOf, rejectionTextOf } from './farm-stop';

const products = [
  { productId: 'p-ginger', name: 'Ginger', uom: 'kg' },
  { productId: 'p-eggs', name: 'Eggs', uom: 'piece' },
  { productId: 'p-chilli', name: 'Chilli', uom: 'g' },
];

describe('farmLinesOf — the farmer stop (driver app D2)', () => {
  it('takes every product accepted or rejected, in the product unit, 3 decimals', () => {
    const lines = farmLinesOf(
      [
        { productId: 'p-ginger', outcome: 'accepted', netQuantity: 480.5, sacks: 10 },
        { productId: 'p-eggs', outcome: 'rejected', reason: 'damaged', rejectedQuantity: 30, note: '  cracked  ' },
        { productId: 'p-chilli', outcome: 'accepted', netQuantity: 2500 },
      ],
      products,
    );
    expect(lines).toEqual([
      { productId: 'p-ginger', outcome: 'accepted', acceptedQuantity: '480.500', rejectedQuantity: '0.000', measuredBy: 'weight', sacks: 10, kgPerBag: null, reason: null, note: null },
      { productId: 'p-eggs', outcome: 'rejected', acceptedQuantity: '0.000', rejectedQuantity: '30.000', measuredBy: 'weight', sacks: null, kgPerBag: null, reason: 'damaged', note: 'cracked' },
      { productId: 'p-chilli', outcome: 'accepted', acceptedQuantity: '2500.000', rejectedQuantity: '0.000', measuredBy: 'weight', sacks: null, kgPerBag: null, reason: null, note: null },
    ]);
  });

  it('works out a bag count itself: sacks × kg a bag, exactly', () => {
    const [line] = farmLinesOf(
      [
        { productId: 'p-ginger', outcome: 'accepted', measuredBy: 'bags', sacks: 7, kgPerBag: 45.125, netQuantity: 1 },
        { productId: 'p-eggs', outcome: 'rejected', reason: 'farmer_not_ready' },
        { productId: 'p-chilli', outcome: 'rejected', reason: 'other' },
      ],
      products,
    );
    expect(line).toMatchObject({ acceptedQuantity: '315.875', measuredBy: 'bags', sacks: 7, kgPerBag: '45.125' });
  });

  it('refuses a farm with a product still open, listing them', () => {
    expect(() => farmLinesOf([{ productId: 'p-ginger', outcome: 'accepted', netQuantity: 1 }], products)).toThrow(
      'Accept or reject every product before completing the farm: Eggs, Chilli still open',
    );
  });

  it.each([
    ['a product twice', [{ productId: 'p-ginger', outcome: 'accepted', netQuantity: 1 }, { productId: 'p-ginger', outcome: 'rejected', reason: 'other' }], 'Ginger is listed twice'],
    ['a product not on the order', [{ productId: 'p-other', outcome: 'accepted', netQuantity: 1 }], 'is not on this pickup'],
    ['an accepted product with no quantity', [{ productId: 'p-ginger', outcome: 'accepted' }], 'How much Ginger was loaded?'],
    ['a rejection without a reason', [{ productId: 'p-ginger', outcome: 'rejected' }], 'Say why Ginger was rejected'],
    ['a rejected product that was loaded', [{ productId: 'p-ginger', outcome: 'rejected', reason: 'damaged', netQuantity: 5 }], 'nothing of it is loaded'],
    ['an accepted product with a reason', [{ productId: 'p-ginger', outcome: 'accepted', netQuantity: 5, reason: 'damaged' }], "a rejection reason doesn't apply"],
    ['bags without the kg in each', [{ productId: 'p-ginger', outcome: 'accepted', measuredBy: 'bags', sacks: 4 }], 'needs the number of bags and the kg in each'],
    ['bags of a counted product', [{ productId: 'p-eggs', outcome: 'accepted', measuredBy: 'bags', sacks: 4, kgPerBag: 10 }], 'counted in piece'],
  ])('refuses %s', (_label, lines, message) => {
    expect(() => farmLinesOf(lines as never, products)).toThrow(message as string);
  });
});

describe('loadedKgOf', () => {
  it('counts the kilos accepted — grams too — never pieces or rejections', () => {
    const lines = farmLinesOf(
      [
        { productId: 'p-ginger', outcome: 'accepted', netQuantity: 480.25 },
        { productId: 'p-eggs', outcome: 'accepted', netQuantity: 300 },
        { productId: 'p-chilli', outcome: 'accepted', netQuantity: 2500 },
      ],
      products,
    );
    expect(loadedKgOf(lines, products)).toBe('482.750');
  });
});

describe('rejectionTextOf', () => {
  it('reads the reason, with the note when there is one', () => {
    expect(rejectionTextOf('quantity_short', null)).toBe('Quantity short');
    expect(rejectionTextOf('farmer_not_ready', 'harvest tomorrow')).toBe('Farmer not ready: harvest tomorrow');
  });
});
