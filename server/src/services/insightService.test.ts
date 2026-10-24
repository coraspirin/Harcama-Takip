import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAlertLevel, buildCalendar, detectAnomalies } from './insightService.ts';

describe('limit uyarisi esikleri', () => {
  test('%80 altinda uyari yok, %80 ve ustu uyari, asimda asildi', () => {
    assert.equal(budgetAlertLevel(79_999, 100_000), null);
    assert.equal(budgetAlertLevel(80_000, 100_000), 'warning');
    assert.equal(budgetAlertLevel(100_000, 100_000), 'warning');
    assert.equal(budgetAlertLevel(100_001, 100_000), 'exceeded');
  });
});

describe('anormal harcama', () => {
  test('ortalamanin 1,5 katini gecen kategori yakalanir', () => {
    const result = detectAnomalies(
      new Map([
        [1, 400_000],
        [2, 120_000],
      ]),
      new Map([
        [1, [200_000, 250_000, 150_000]],
        [2, [100_000, 100_000, 100_000]],
      ]),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.categoryId, 1);
    assert.equal(result[0]?.averageKurus, 200_000);
    assert.equal(result[0]?.ratio, 2);
  });

  test('yeterli gecmis yoksa veya kalem kucukse uyari yok', () => {
    assert.equal(detectAnomalies(new Map([[1, 900_000]]), new Map([[1, [100_000, 100_000]]])).length, 0);
    assert.equal(detectAnomalies(new Map([[1, 90_000]]), new Map([[1, [10_000, 10_000, 10_000]]])).length, 0);
  });
});

describe('takvim', () => {
  const base = {
    month: '2026-11',
    daysInMonth: 30,
    today: '2026-11-10',
  };

  test('ay basindan net akis gun gun birikir; bekleyenler bugunden sonra tahmine girer', () => {
    const days = buildCalendar({
      ...base,
      totalsByDay: new Map([
        ['2026-11-01', { incomeKurus: 1_000_000, expenseKurus: 0 }],
        ['2026-11-05', { incomeKurus: 0, expenseKurus: 300_000 }],
      ]),
      pending: [
        { id: 1, name: 'Kira', direction: 'expense', amountKurus: 900_000, dueDate: '2026-11-15' },
        { id: 2, name: 'Maas', direction: 'income', amountKurus: 2_000_000, dueDate: '2026-11-25' },
      ],
    });

    assert.equal(days.length, 30);
    assert.equal(days[0]?.cumulativeKurus, 1_000_000);
    assert.equal(days[4]?.cumulativeKurus, 700_000);
    // 15'inde kira: 700.000 - 900.000 = eksi -> sikisik gun
    assert.equal(days[14]?.cumulativeKurus, -200_000);
    assert.equal(days[14]?.tight, true);
    assert.equal(days[24]?.cumulativeKurus, 1_800_000);
    assert.equal(days[24]?.tight, false);
  });

  test('gecikmis bekleyen bugune tasinir ve isaretlenir', () => {
    const days = buildCalendar({
      ...base,
      totalsByDay: new Map(),
      pending: [{ id: 1, name: 'Fatura', direction: 'expense', amountKurus: 50_000, dueDate: '2026-11-03' }],
    });
    assert.equal(days[2]?.pending.length, 0);
    assert.equal(days[9]?.pending[0]?.overdue, true);
    assert.equal(days[9]?.cumulativeKurus, -50_000);
  });

  test('tutari bilinmeyen bekleyen gosterilir ama tahmine girmez', () => {
    const days = buildCalendar({
      ...base,
      totalsByDay: new Map(),
      pending: [{ id: 1, name: 'Dogalgaz', direction: 'expense', amountKurus: null, dueDate: '2026-11-20' }],
    });
    assert.equal(days[19]?.pending.length, 1);
    assert.equal(days[19]?.cumulativeKurus, 0);
  });
});
