import { daysFrom, disputeStatusOf, expenseStatusOf, handoverStatusOf, maintenanceDueOf, minutesBetween, placesOf } from './driver-records';
import { kmPerLitre } from './driver-records.service';

describe('the driver’s own records (driver app D6)', () => {
  describe('expenseStatusOf', () => {
    it('an expense within the driver’s authority is simply recorded', () => {
      expect(expenseStatusOf({ needsApproval: false, decision: null }, 'in_progress')).toBe('recorded');
    });
    it('beyond it, it waits for the owner — until decided', () => {
      expect(expenseStatusOf({ needsApproval: true, decision: null }, 'in_progress')).toBe('pending');
      expect(expenseStatusOf({ needsApproval: true, decision: null }, 'completed')).toBe('pending');
      expect(expenseStatusOf({ needsApproval: true, decision: 'approved' }, 'in_progress')).toBe('approved');
      expect(expenseStatusOf({ needsApproval: true, decision: 'rejected' }, 'reconciled')).toBe('rejected');
    });
    it('closing the trip without a word approves it with the closure', () => {
      expect(expenseStatusOf({ needsApproval: true, decision: null }, 'reconciled')).toBe('approved');
    });
  });

  it('a dispute: open waits, resolved is settled, withdrawn didn’t go ahead', () => {
    expect(disputeStatusOf('open')).toBe('pending');
    expect(disputeStatusOf('resolved')).toBe('approved');
    expect(disputeStatusOf('withdrawn')).toBe('rejected');
  });

  it('a handover: checked, closed, or sent back', () => {
    expect(handoverStatusOf('completed', null)).toBe('pending');
    expect(handoverStatusOf('on_hold', 'Where is the Onion?')).toBe('pending');
    expect(handoverStatusOf('reconciled', null)).toBe('approved');
    expect(handoverStatusOf('in_progress', 'Count the cash again')).toBe('rejected');
    expect(handoverStatusOf('in_progress', null)).toBeNull();
    expect(handoverStatusOf('planned', null)).toBeNull();
  });

  it('the places visited, a place repeated in a row named once', () => {
    expect(placesOf(['Gundlupet', 'Gundlupet', null, 'Mysuru', ' Mysuru ', 'Gundlupet'])).toEqual(['Gundlupet', 'Mysuru', 'Gundlupet']);
    expect(placesOf([])).toEqual([]);
  });

  it('minutes on the road', () => {
    expect(minutesBetween(new Date('2026-10-30T02:45:00Z'), new Date('2026-10-30T12:05:00Z'))).toBe(560);
    expect(minutesBetween(null, new Date())).toBeNull();
    expect(minutesBetween(new Date('2026-10-30T02:45:00Z'), new Date('2026-10-30T02:00:00Z'))).toBeNull();
  });

  it('days to a date, negative once past', () => {
    expect(daysFrom('2026-10-30', '2026-11-12')).toBe(13);
    expect(daysFrom('2026-10-30', '2026-10-07')).toBe(-23);
  });

  it('km per litre on a trip', () => {
    expect(kmPerLitre('192.0', '20.250')).toBe('9.48');
    expect(kmPerLitre(null, '20.000')).toBeNull();
    expect(kmPerLitre('192.0', '0.000')).toBeNull();
  });

  describe('maintenanceDueOf', () => {
    const rec = (kind: string, serviceDate: string, nextDueKm: number | null, nextDueDate: string | null = null) => ({
      kind,
      description: kind,
      serviceDate,
      odometerKm: 46000,
      nextDueDate,
      nextDueKm,
    });

    it('one line per kind of work — its latest record that set a next due', () => {
      const due = maintenanceDueOf(
        [rec('service', '2026-03-01', 46000), rec('service', '2026-08-01', 50000), rec('tyres', '2026-05-01', 60000), rec('battery', '2026-05-01', null)],
        48812,
        '2026-10-30',
      );
      expect(due.map((d) => [d.kind, d.nextDueKm, d.kmLeft, d.state])).toEqual([
        ['service', 50000, 1188, 'due_soon'],
        ['tyres', 60000, 11188, 'ok'],
      ]);
    });

    it('overdue once the reading or the date is reached, soonest first', () => {
      const due = maintenanceDueOf([rec('service', '2026-08-01', 48000), rec('other', '2026-08-01', null, '2026-11-05'), rec('repair', '2026-08-01', null, '2026-10-01')], 48812, '2026-10-30');
      expect(due.map((d) => [d.kind, d.state, d.daysLeft])).toEqual([
        ['service', 'overdue', null],
        ['repair', 'overdue', -29],
        ['other', 'due_soon', 6],
      ]);
    });

    it('a reading not known yet goes by the date alone', () => {
      expect(maintenanceDueOf([rec('service', '2026-08-01', 50000)], null, '2026-10-30')[0]).toMatchObject({ kmLeft: null, state: 'ok' });
    });
  });
});
