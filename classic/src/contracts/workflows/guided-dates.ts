/** Calendar-day comparisons; values are dates, never timestamps. */
export const GUIDED_DATE_OPERATORS = {
  equals: 'é em',
  not_equals: 'não é em',
  before: 'é antes de',
  on_or_before: 'é até',
  after: 'é depois de',
  on_or_after: 'é a partir de',
} as const;
export type GuidedDateOperator = keyof typeof GUIDED_DATE_OPERATORS;
export type GuidedDateComparison = { operator: GuidedDateOperator; value: string }
  | { operator: 'is_empty' } | { operator: 'is_not_empty' };
export function isGuidedDateOperator(value: unknown): value is GuidedDateOperator {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_DATE_OPERATORS, value);
}
export function isGuidedCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
