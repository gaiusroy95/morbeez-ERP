import { earliest, oldestOutstanding, overdueSeverity } from './crates-math';

describe('oldestOutstanding', () => {
  it('returns come off the oldest crates first', () => {
    const r = oldestOutstanding([
      { on: '2026-09-01', delta: 20 },
      { on: '2026-09-10', delta: 15 },
      { on: '2026-09-12', delta: -25 },
    ]);
    // the 20 from the 1st are all back, and 5 of the 15 from the 10th
    expect(r).toEqual({ since: '2026-09-10', outstanding: 10 });
  });

  it('nothing out, no date', () => {
    expect(oldestOutstanding([{ on: '2026-09-01', delta: 5 }, { on: '2026-09-02', delta: -5 }])).toEqual({ since: null, outstanding: 0 });
  });

  it('crates in and out on the same day: ins count first', () => {
    const r = oldestOutstanding([
      { on: '2026-09-05', delta: -4 },
      { on: '2026-09-05', delta: 10 },
    ]);
    expect(r).toEqual({ since: '2026-09-05', outstanding: 6 });
  });

  it('events out of order are sorted by date', () => {
    const r = oldestOutstanding([
      { on: '2026-09-20', delta: 3 },
      { on: '2026-09-02', delta: 8 },
      { on: '2026-09-15', delta: -8 },
    ]);
    expect(r).toEqual({ since: '2026-09-20', outstanding: 3 });
  });
});

describe('alert helpers', () => {
  it('earliest date, ignoring nulls', () => {
    expect(earliest([null, '2026-09-10', '2026-08-31'])).toBe('2026-08-31');
    expect(earliest([null])).toBeNull();
  });

  it('overdue past the allowance, bad past twice it', () => {
    expect(overdueSeverity(7, 7)).toBeNull();
    expect(overdueSeverity(8, 7)).toBe('attention');
    expect(overdueSeverity(15, 7)).toBe('bad');
    expect(overdueSeverity(null, 7)).toBeNull();
  });
});
