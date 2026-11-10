import { ProcurementLifecycleFacts, procurementLifecycleOf } from './procurement-lifecycle';

const at = (over: Partial<ProcurementLifecycleFacts> = {}): ProcurementLifecycleFacts => ({
  status: 'confirmed',
  onTrip: false,
  arrived: false,
  pickedUp: false,
  received: '0',
  expected: '500.000',
  owed: null,
  ...over,
});

describe('procurementLifecycleOf — Master Spec v3 §11', () => {
  it('walks DRAFT → CONFIRMED → ASSIGNED → PICKUP → PICKED UP → SETTLED', () => {
    expect(procurementLifecycleOf(at({ status: 'placed' }))).toBe('draft');
    expect(procurementLifecycleOf(at())).toBe('confirmed');
    expect(procurementLifecycleOf(at({ onTrip: true }))).toBe('assigned');
    expect(procurementLifecycleOf(at({ onTrip: true, arrived: true }))).toBe('pickup');
    expect(procurementLifecycleOf(at({ status: 'received', onTrip: true, pickedUp: true, received: '500.000', owed: '10000.00' }))).toBe('picked_up');
    expect(procurementLifecycleOf(at({ status: 'received', onTrip: true, pickedUp: true, received: '500.000', owed: '0.00' }))).toBe('settled');
  });

  it('less received than expected is partially picked — nothing received at a finished stop too', () => {
    expect(procurementLifecycleOf(at({ status: 'received', pickedUp: true, received: '480.000', owed: '9600.00' }))).toBe('partially_picked');
    expect(procurementLifecycleOf(at({ status: 'received', pickedUp: true, received: '0' }))).toBe('partially_picked');
  });

  it('nothing accrued yet is not settled; a cancelled order is cancelled whatever else', () => {
    expect(procurementLifecycleOf(at({ status: 'received', pickedUp: true, received: '500.000', owed: null }))).toBe('picked_up');
    expect(procurementLifecycleOf(at({ status: 'cancelled', onTrip: true }))).toBe('cancelled');
  });
});
