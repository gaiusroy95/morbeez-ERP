// Identifiers and calendars of Indian indirect and direct tax that don't
// change with a budget: the GST state-code table, how a GSTIN and a PAN are
// built, the financial year (1 April – 31 March) and its quarters. Rates
// and thresholds are NOT here — they're data (tax.gst_rate,
// tax.tds_section), so a rate change is a settings change, not a release.

/** GST state and union-territory codes (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu (before the 2020 merger)',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (before 2014)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_SHAPE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The GSTIN's 15th character: a base-36 check over the first 14. */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** Null when valid; otherwise what's wrong, in words. */
export function gstinProblem(gstin: string): string | null {
  if (!GSTIN_SHAPE.test(gstin)) return 'A GSTIN is 15 characters: 2-digit state code, 10-character PAN, entity number, Z, check character';
  if (!GST_STATES[gstin.slice(0, 2)]) return `${gstin.slice(0, 2)} is not a GST state code`;
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) return 'The GSTIN check character does not match — check for a typo';
  return null;
}

export function isValidPan(pan: string): boolean {
  return PAN_SHAPE.test(pan);
}

export function isValidTan(tan: string): boolean {
  return TAN_SHAPE.test(tan);
}

/**
 * The PAN's fourth character says who holds it. Individuals (P) and HUFs
 * (H) take the lower TDS rate where a section has two.
 */
export function deducteeTypeFromPan(pan: string): 'individual_huf' | 'other' {
  return pan[3] === 'P' || pan[3] === 'H' ? 'individual_huf' : 'other';
}

/** Unit Quantity Codes the GST portal and e-invoice schema use, from our units. */
export const UQC: Record<string, string> = {
  kg: 'KGS',
  g: 'GMS',
  crate: 'OTH',
  bag: 'BAG',
  dozen: 'DOZ',
  unit: 'NOS',
};

/** "2026-27" for any date from 1 April 2026 to 31 March 2027. */
export function financialYear(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function financialYearStart(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** TDS return quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar. */
export function tdsQuarter(date: string): 1 | 2 | 3 | 4 {
  const m = Number(date.slice(5, 7));
  return (m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4) as 1 | 2 | 3 | 4;
}

export function quarterRange(fy: string, quarter: 1 | 2 | 3 | 4): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  switch (quarter) {
    case 1:
      return { from: `${start}-04-01`, to: `${start}-06-30` };
    case 2:
      return { from: `${start}-07-01`, to: `${start}-09-30` };
    case 3:
      return { from: `${start}-10-01`, to: `${start}-12-31` };
    case 4:
      return { from: `${start + 1}-01-01`, to: `${start + 1}-03-31` };
  }
}

/**
 * When TDS deducted in a month must be deposited: the 7th of the next
 * month, except March's, due 30 April (Income-tax Rules, rule 30).
 */
export function tdsDepositDueDate(deductedOn: string): string {
  const [y, m] = deductedOn.split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const next = new Date(Date.UTC(y, m, 7)); // month index m = the following month
  return next.toISOString().slice(0, 10);
}
