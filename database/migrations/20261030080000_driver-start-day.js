/* eslint-disable camelcase */

// Driver app V1, Phase D1 — Start Day (docs/redesign/driver-app-v1-plan.md):
// starting the day's trip records the vehicle's odometer (opening KM) and
// where the phone was (GPS, with its accuracy). Both stay null for trips
// started before this, or from the owner app without them.

exports.shorthands = undefined;

const TRIP = { schema: 'fulfilment', name: 'trip' };

exports.up = (pgm) => {
  pgm.addColumns(TRIP, {
    opening_km: { type: 'numeric(10,1)' },
    start_latitude: { type: 'numeric(9,6)' },
    start_longitude: { type: 'numeric(9,6)' },
    start_accuracy_m: { type: 'numeric(8,1)' },
  });
  pgm.addConstraint(TRIP, 'trip_start_readings_valid', {
    check: `(opening_km IS NULL OR opening_km >= 0)
            AND (start_latitude IS NULL) = (start_longitude IS NULL)
            AND (start_latitude IS NULL OR (start_latitude BETWEEN -90 AND 90 AND start_longitude BETWEEN -180 AND 180))
            AND (start_accuracy_m IS NULL OR (start_latitude IS NOT NULL AND start_accuracy_m >= 0))`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(TRIP, 'trip_start_readings_valid');
  pgm.dropColumns(TRIP, ['opening_km', 'start_latitude', 'start_longitude', 'start_accuracy_m']);
};
