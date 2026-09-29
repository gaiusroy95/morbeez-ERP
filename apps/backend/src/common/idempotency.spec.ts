import { BadRequestException, ConflictException } from '@nestjs/common';
import { idempotencyKey, once } from './idempotency';

// Security Audit SA-03: a retried driver sync must never record cash twice.
describe('idempotency', () => {
  const KEY = '3f2b8a52-6f0e-4d3e-9a57-6b1f5f2a9c10';
  const record = { id: 'c1', amount: '500.00' };

  it('accepts a UUID header and treats a missing one as no key', () => {
    expect(idempotencyKey(undefined)).toBeNull();
    expect(idempotencyKey('')).toBeNull();
    expect(idempotencyKey(KEY.toUpperCase())).toBe(KEY);
    expect(() => idempotencyKey('retry-1')).toThrow(BadRequestException);
  });

  it('writes normally when no key is sent', async () => {
    const find = jest.fn();
    const write = jest.fn().mockResolvedValue(record);
    await expect(once({ key: null, constraint: 'c', find, sameRequest: () => true, write })).resolves.toBe(record);
    expect(find).not.toHaveBeenCalled();
  });

  it('a retry of a request that already went through returns the first result without writing', async () => {
    const write = jest.fn();
    const got = await once({ key: KEY, constraint: 'c', find: async () => record, sameRequest: () => true, write });
    expect(got).toBe(record);
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a key reused for a different request', async () => {
    await expect(
      once({ key: KEY, constraint: 'c', find: async () => record, sameRequest: () => false, write: jest.fn() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('two copies racing: the loser gets the winner’s row back', async () => {
    const find = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(record);
    const write = jest.fn().mockRejectedValue({ code: '23505', constraint: 'customer_collection_client_ref_unique' });
    const got = await once({ key: KEY, constraint: 'customer_collection_client_ref_unique', find, sameRequest: () => true, write });
    expect(got).toBe(record);
  });

  it('other unique violations are not mistaken for a replay', async () => {
    const write = jest.fn().mockRejectedValue({ code: '23505', constraint: 'something_else' });
    await expect(
      once({ key: KEY, constraint: 'customer_collection_client_ref_unique', find: async () => null, sameRequest: () => true, write }),
    ).rejects.toEqual({ code: '23505', constraint: 'something_else' });
  });
});
