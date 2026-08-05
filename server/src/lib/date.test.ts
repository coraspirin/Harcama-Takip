import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  addMonths,
  addMonthsToYearMonth,
  daysBetween,
  daysInMonth,
  formatTR,
  isIsoDate,
  monthRange,
  toYearMonth,
} from './date.ts';

test('isIsoDate - gecerli/gecersiz tarihler', () => {
  assert.equal(isIsoDate('2026-07-22'), true);
  assert.equal(isIsoDate('2026-02-29'), false); // 2026 artik yil degil
  assert.equal(isIsoDate('2024-02-29'), true);
  assert.equal(isIsoDate('2026-13-01'), false);
  assert.equal(isIsoDate('22.07.2026'), false);
});

test('formatTR - gun.ay.yil', () => {
  assert.equal(formatTR('2026-07-22'), '22.07.2026');
});

test('addMonths - ay sonu tasmasi ayin son gunune sabitlenir', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // artik yil
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-03-15', -3), '2025-12-15');
});

test('addMonths - 12 taksit yil sinirini gecer', () => {
  assert.equal(addMonths('2026-08-05', 11), '2027-07-05');
});

test('addDays / daysBetween', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-07-01', '2026-07-31'), 30);
  assert.equal(daysBetween('2026-07-31', '2026-07-01'), -30);
});

test('monthRange - ayin ilk ve son gunu', () => {
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(monthRange('2026-07'), { start: '2026-07-01', end: '2026-07-31' });
});

test('toYearMonth / addMonthsToYearMonth', () => {
  assert.equal(toYearMonth('2026-07-22'), '2026-07');
  assert.equal(addMonthsToYearMonth('2026-01', -1), '2025-12');
  assert.equal(daysInMonth(2026, 2), 28);
});
