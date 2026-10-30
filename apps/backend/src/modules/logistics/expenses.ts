// Expenses on the road (driver app V1, D6): the checks on what the driver
// records, kept pure so they're tested on their own (expenses.spec.ts).

import { multiplyToMoney, toCents } from '../../common/money';
import { TripRecord } from './entities/trip.entity';

/** What a pump's bill may differ from litres × rate by — the pump rounds. */
const PUMP_ROUNDING_CENTS = 100n;

interface FuelFields {
  category: string;
  amount: number;
  odometerKm?: number;
  fuelType?: string;
  fullTank?: boolean;
  litres?: number;
  ratePerLitre?: number;
}

/** Why a fuel expense's pump details don't hold together; null when they do (or there are none). */
export function fuelProblemOf(dto: FuelFields): string | null {
  const any = [dto.odometerKm, dto.fuelType, dto.fullTank, dto.litres, dto.ratePerLitre].some((v) => v !== undefined);
  if (!any) return null;
  if (dto.category !== 'fuel') return 'Only a fuel expense has an odometer, fuel type, litres and rate';
  if ((dto.litres === undefined) !== (dto.ratePerLitre === undefined)) return 'Litres and the rate per litre go together';
  if (dto.litres !== undefined && dto.ratePerLitre !== undefined) {
    const expected = multiplyToMoney(dto.litres.toFixed(3), dto.ratePerLitre.toFixed(2));
    const diff = toCents(dto.amount.toFixed(2)) - toCents(expected);
    if (diff > PUMP_ROUNDING_CENTS || -diff > PUMP_ROUNDING_CENTS) {
      return `₹${dto.amount.toFixed(2)} doesn't match ${dto.litres} L at ₹${dto.ratePerLitre.toFixed(2)} a litre (₹${expected})`;
    }
  }
  return null;
}

/**
 * Why an odometer read at the pump can't be right on this trip; null when
 * it can: never below where the trip set off or an earlier fill on it, and
 * never past what Return read.
 */
export function odometerProblemOf(km: number, trip: Pick<TripRecord, 'openingKm' | 'closingKm'>, earlierOnTrip: number | null): string | null {
  if (trip.openingKm !== null && km < Number(trip.openingKm)) {
    return `The odometer read ${Number(trip.openingKm)} km when the trip set off — it can't read less at the pump`;
  }
  if (earlierOnTrip !== null && km < earlierOnTrip) {
    return `An earlier fill on this trip read ${earlierOnTrip} km — the odometer can't read less after it`;
  }
  if (trip.closingKm !== null && km > Number(trip.closingKm)) {
    return `Return read ${Number(trip.closingKm)} km — a fill on this trip can't read more`;
  }
  return null;
}
