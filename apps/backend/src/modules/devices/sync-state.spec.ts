import { phoneState } from './sync-state';

describe("a driver's phone, as its last report left it", () => {
  const now = new Date('2026-10-30T10:00:00Z');
  const report = (over = {}) => ({ pendingOperations: 0, failedOperations: 0, pendingPhotos: 0, failedPhotos: 0, reportedAt: new Date('2026-10-30T09:50:00Z'), ...over });

  it('nothing left on it: synced; work not sent yet: waiting', () => {
    expect(phoneState(report(), now)).toBe('synced');
    expect(phoneState(report({ pendingOperations: 3 }), now)).toBe('waiting');
    expect(phoneState(report({ pendingPhotos: 1 }), now)).toBe('waiting');
  });

  it('something the server refused is stuck — however old the report', () => {
    expect(phoneState(report({ pendingOperations: 2, failedOperations: 1 }), now)).toBe('stuck');
    expect(phoneState(report({ pendingPhotos: 1, failedPhotos: 1, reportedAt: new Date('2026-10-29T09:00:00Z') }), now)).toBe('stuck');
  });

  it('not heard from for two hours: quiet; never at all: never', () => {
    expect(phoneState(report({ pendingOperations: 3, reportedAt: new Date('2026-10-30T07:30:00Z') }), now)).toBe('quiet');
    expect(phoneState(null, now)).toBe('never');
  });
});
