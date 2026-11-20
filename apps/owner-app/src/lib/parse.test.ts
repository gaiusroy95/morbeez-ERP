import { describe, expect, it } from 'vitest';
import { firstError, optionalText, parseDecimal, parseLocation, parseMoney, parseOptionalMoney, parseQuantity, parseWholeNumber } from './parse';

// What an owner types becomes what the API is sent — a wrong conversion here
// is a wrong price or quantity on a real invoice (Testing Strategy UT.4).
describe('parseDecimal', () => {
  it('takes Indian digit grouping as typed', () => {
    expect(parseMoney('1,20,000.50', 'the price')).toEqual({ ok: true, value: 120000.5 });
    expect(parseQuantity(' 12.125 ', 'the quantity')).toEqual({ ok: true, value: 12.125 });
  });

  it('refuses more decimals than money (2) or quantity (3) carries, in words', () => {
    expect(parseMoney('10.005', 'the price')).toEqual({ ok: false, error: 'The price must be a number with at most 2 decimal places.' });
    expect(parseQuantity('1.0005', 'the quantity')).toEqual({ ok: false, error: 'The quantity must be a number with at most 3 decimal places.' });
  });

  it('refuses blanks, negatives and text', () => {
    expect(parseMoney('', 'the price')).toEqual({ ok: false, error: 'Enter the price.' });
    expect(parseMoney('-5', 'the price').ok).toBe(false);
    expect(parseMoney('ten', 'the price').ok).toBe(false);
  });

  it('positive refuses zero; quantities are positive by default, money is not', () => {
    expect(parseQuantity('0', 'the quantity')).toEqual({ ok: false, error: 'The quantity must be more than zero.' });
    expect(parseMoney('0', 'the discount')).toEqual({ ok: true, value: 0 });
    expect(parseMoney('0', 'the price', true).ok).toBe(false);
  });

  it('enforces a maximum', () => {
    expect(parseDecimal('101', 'the margin', { decimals: 2, max: 100 })).toEqual({ ok: false, error: "The margin can't be more than 100." });
  });
});

describe('optional and whole-number fields', () => {
  it('a blank optional amount is "not given", not zero', () => {
    expect(parseOptionalMoney('  ', 'the advance')).toEqual({ ok: true, value: undefined });
    expect(parseOptionalMoney('500', 'the advance')).toEqual({ ok: true, value: 500 });
  });

  it('whole numbers stay inside their range', () => {
    expect(parseWholeNumber('30', 'payment terms', 0, 365)).toEqual({ ok: true, value: 30 });
    expect(parseWholeNumber('7.5', 'payment terms', 0, 365)).toEqual({ ok: false, error: 'Payment terms must be a whole number.' });
    expect(parseWholeNumber('400', 'payment terms', 0, 365)).toEqual({ ok: false, error: 'Payment terms must be between 0 and 365.' });
  });

  it('blank text is left out rather than sent as ""', () => {
    expect(optionalText('   ')).toBeUndefined();
    expect(optionalText('  Gate 2 ')).toBe('Gate 2');
  });

  it('firstError reports the first problem among several fields', () => {
    expect(firstError([parseMoney('5', 'a'), parseMoney('', 'the price'), parseMoney('x', 'b')])).toBe('Enter the price.');
    expect(firstError([parseMoney('5', 'a')])).toBeNull();
  });
});

// A new customer's shop, taken down by the owner (client, 20 Nov 2026): typed, or pasted from Google Maps.
describe('parseLocation', () => {
  const at = (latitude: number, longitude: number) => ({ ok: true, value: { latitude, longitude } });
  it('typed: a comma or a space between, any spacing, rounded to 6 places', () => {
    expect(parseLocation('12.3108, 76.6402')).toEqual(at(12.3108, 76.6402));
    expect(parseLocation(' 12.3108 76.6402 ')).toEqual(at(12.3108, 76.6402));
    expect(parseLocation('12.31081234,76.64019876')).toEqual(at(12.310812, 76.640199));
    expect(parseLocation('-33.8688, 151.2093')).toEqual(at(-33.8688, 151.2093));
  });
  it('pasted from Google Maps: the pin, the place link or a search', () => {
    expect(parseLocation('https://www.google.com/maps/place/Hotel/@12.3051,76.6551,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d12.305123!4d76.655456')).toEqual(at(12.305123, 76.655456));
    expect(parseLocation('https://www.google.com/maps/@12.3051,76.6551,17z')).toEqual(at(12.3051, 76.6551));
    expect(parseLocation('https://maps.google.com/?q=12.3051,76.6551')).toEqual(at(12.3051, 76.6551));
    expect(parseLocation('https://www.google.com/maps/search/?api=1&query=12.3051%2C76.6551')).toEqual(at(12.3051, 76.6551));
  });
  it('blank is no location; nonsense, out of range or 0, 0 asks again', () => {
    expect(parseLocation('  ')).toEqual({ ok: true, value: null });
    for (const bad of ['near the bus stand', '95.1, 76.6', '12.3, 190', '0, 0', '12.3', 'https://maps.app.goo.gl/AbCd123']) {
      expect(parseLocation(bad).ok, bad).toBe(false);
    }
  });
});
