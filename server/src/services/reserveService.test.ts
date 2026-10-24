import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateReserve, isDueInMonth, monthlyEquivalent } from './reserveService.ts';

describe('seyrek giderlerin aylik payi', () => {
  test('yillik tutar 12ye, uc aylik tutar 3e bolunur', () => {
    assert.equal(monthlyEquivalent(1_200_000, 'yearly'), 100_000);
    assert.equal(monthlyEquivalent(90_000, 'quarterly'), 30_000);
    assert.equal(monthlyEquivalent(19_990, 'monthly'), 19_990);
  });

  test('aylik kalemler pay hesabina girmez', () => {
    const reserve = calculateReserve(
      [{ id: 1, name: 'Internet', period: 'monthly', amountKurus: 50_000, startDate: '2026-01-05' }],
      '2026-11',
    );
    assert.equal(reserve.items.length, 0);
    assert.equal(reserve.monthlyKurus, 0);
  });

  test('vadesi bu ay olan kalemin payi ayrilmaz (zaten bekleyen odemede)', () => {
    const reserve = calculateReserve(
      [
        { id: 1, name: 'Kasko', period: 'yearly', amountKurus: 1_200_000, startDate: '2026-03-10' },
        { id: 2, name: 'Emlak vergisi', period: 'yearly', amountKurus: 600_000, startDate: '2025-11-30' },
      ],
      '2026-11',
    );
    assert.equal(reserve.items.length, 2);
    assert.equal(reserve.items.find((i) => i.id === 2)?.dueThisMonth, true);
    // Yalnizca kasko: 1.200.000 / 12
    assert.equal(reserve.monthlyKurus, 100_000);
  });

  test('tutari bilinmeyen kalem sayilir ama toplama girmez', () => {
    const reserve = calculateReserve(
      [{ id: 1, name: 'Dogalgaz', period: 'quarterly', amountKurus: null, startDate: '2026-02-15' }],
      '2026-11',
    );
    assert.equal(reserve.unknownCount, 1);
    assert.equal(reserve.monthlyKurus, 0);
  });
});

describe('vade ayi tespiti', () => {
  test('periyot adimlariyla vade aylari bulunur', () => {
    assert.equal(isDueInMonth('2026-03-10', 'yearly', '2030-03'), true);
    assert.equal(isDueInMonth('2026-03-10', 'yearly', '2030-04'), false);
    assert.equal(isDueInMonth('2026-02-15', 'quarterly', '2026-08'), true);
    assert.equal(isDueInMonth('2026-02-15', 'quarterly', '2026-09'), false);
  });

  test('ilk vadeden onceki aylarda vade yoktur', () => {
    assert.equal(isDueInMonth('2026-03-10', 'yearly', '2025-03'), false);
  });
});
