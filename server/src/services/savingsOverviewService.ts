import { addMonthsToYearMonth, toYearMonth, type IsoDate, type YearMonth } from '../lib/date.ts';
import { listGoals, listUserContributions, type ContributionRow, type SavingsGoalRow } from '../db/savings.ts';
import { monthlyNatureTotals } from '../db/reports.ts';
import {
  calculateGoalProgress,
  monthlySavingsCommitment,
  suggestEmergencyFund,
} from './savingsForecastService.ts';

/** Acil durum fonu onerisi icin geriye bakilan ay sayisi (bu ay haric). */
const EMERGENCY_BASIS_MONTHS = 6;

function groupByGoal(rows: ContributionRow[]): Map<number, ContributionRow[]> {
  const map = new Map<number, ContributionRow[]>();
  for (const row of rows) {
    const list = map.get(row.goal_id) ?? [];
    list.push(row);
    map.set(row.goal_id, list);
  }
  return map;
}

export function serializeGoal(goal: SavingsGoalRow, contributions: ContributionRow[], today: IsoDate) {
  const month = toYearMonth(today);
  return {
    id: goal.id,
    name: goal.name,
    targetKurus: goal.target_kurus,
    targetDate: goal.target_date,
    monthlyPlanKurus: goal.monthly_plan_kurus,
    isEmergencyFund: goal.is_emergency_fund === 1,
    note: goal.note,
    closed: goal.closed === 1,
    contributedThisMonthKurus: contributions
      .filter((c) => toYearMonth(c.date) === month)
      .reduce((sum, c) => sum + c.amount_kurus, 0),
    progress: calculateGoalProgress({
      targetKurus: goal.target_kurus,
      targetDate: goal.target_date,
      today,
      contributions: contributions.map((c) => ({ date: c.date, amountKurus: c.amount_kurus })),
    }),
  };
}

export function serializeContribution(row: ContributionRow) {
  return { id: row.id, goalId: row.goal_id, date: row.date, amountKurus: row.amount_kurus, note: row.note };
}

/** Birikimler sayfasi: hedefler, toplamlar ve acil durum fonu onerisi. */
export function getSavingsOverview(userId: number, today: IsoDate, includeClosed = false) {
  const byGoal = groupByGoal(listUserContributions(userId));
  const goals = listGoals(userId, includeClosed).map((g) => serializeGoal(g, byGoal.get(g.id) ?? [], today));
  const open = goals.filter((g) => !g.closed);

  const month = toYearMonth(today);
  const fixed = monthlyNatureTotals(
    userId,
    addMonthsToYearMonth(month, -EMERGENCY_BASIS_MONTHS),
    addMonthsToYearMonth(month, -1),
  ).map((r) => Number(r.fixed_expense_kurus));

  return {
    goals,
    totals: {
      savedKurus: open.reduce((sum, g) => sum + g.progress.savedKurus, 0),
      targetKurus: open.reduce((sum, g) => sum + g.targetKurus, 0),
      monthlyPlanKurus: open.reduce((sum, g) => sum + (g.monthlyPlanKurus ?? 0), 0),
      contributedThisMonthKurus: open.reduce((sum, g) => sum + g.contributedThisMonthKurus, 0),
    },
    emergencyFund: suggestEmergencyFund(fixed),
  };
}

/**
 * Verilen ayda birikime giden tutar (ay durumunda serbest paradan dusulur).
 * Gecmis ayda yalnizca gercek katkilar; bu ay ve sonrasinda plan ile katkinin
 * buyugu.
 */
export function savingsForMonth(userId: number, month: YearMonth, today: IsoDate): number {
  const byGoal = groupByGoal(listUserContributions(userId));
  const inMonth = (goalId: number) =>
    (byGoal.get(goalId) ?? [])
      .filter((c) => toYearMonth(c.date) === month)
      .reduce((sum, c) => sum + c.amount_kurus, 0);

  const goals = listGoals(userId);
  if (month < toYearMonth(today)) {
    return goals.reduce((sum, g) => sum + Math.max(0, inMonth(g.id)), 0);
  }
  return monthlySavingsCommitment(
    goals.map((g) => ({ monthlyPlanKurus: g.monthly_plan_kurus, contributedThisMonthKurus: inMonth(g.id) })),
  );
}
