import { getDb } from './connection.ts';

export type SavingsGoalRow = {
  id: number;
  user_id: number;
  name: string;
  target_kurus: number;
  target_date: string | null;
  monthly_plan_kurus: number | null;
  is_emergency_fund: number;
  note: string | null;
  closed: number;
  created_at: string;
  updated_at: string;
};

export type ContributionRow = {
  id: number;
  user_id: number;
  goal_id: number;
  date: string;
  amount_kurus: number;
  note: string | null;
  created_at: string;
};

export function listGoals(userId: number, includeClosed = false): SavingsGoalRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM savings_goals
       WHERE user_id = ? AND (? = 1 OR closed = 0)
       ORDER BY closed, is_emergency_fund DESC, name COLLATE NOCASE`,
    )
    .all(userId, includeClosed ? 1 : 0) as SavingsGoalRow[];
}

export function findGoal(userId: number, id: number): SavingsGoalRow | null {
  const row = getDb()
    .prepare('SELECT * FROM savings_goals WHERE user_id = ? AND id = ?')
    .get(userId, id) as SavingsGoalRow | undefined;
  return row ?? null;
}

export type GoalInput = {
  name: string;
  targetKurus: number;
  targetDate: string | null;
  monthlyPlanKurus: number | null;
  isEmergencyFund: boolean;
  note: string | null;
};

export function insertGoal(userId: number, input: GoalInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO savings_goals
         (user_id, name, target_kurus, target_date, monthly_plan_kurus, is_emergency_fund, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      input.name,
      input.targetKurus,
      input.targetDate,
      input.monthlyPlanKurus,
      input.isEmergencyFund ? 1 : 0,
      input.note,
    );
  return Number(result.lastInsertRowid);
}

export function updateGoal(userId: number, id: number, input: GoalInput & { closed: boolean }): void {
  getDb()
    .prepare(
      `UPDATE savings_goals
       SET name = ?, target_kurus = ?, target_date = ?, monthly_plan_kurus = ?,
           is_emergency_fund = ?, note = ?, closed = ?, updated_at = datetime('now')
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      input.name,
      input.targetKurus,
      input.targetDate,
      input.monthlyPlanKurus,
      input.isEmergencyFund ? 1 : 0,
      input.note,
      input.closed ? 1 : 0,
      userId,
      id,
    );
}

export function deleteGoal(userId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM savings_goals WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return Number(result.changes) > 0;
}

/** Kullanicinin tum katkilari; hedef bazinda gruplamak icin tek sorgu. */
export function listUserContributions(userId: number): ContributionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM savings_contributions WHERE user_id = ?
       ORDER BY date DESC, id DESC`,
    )
    .all(userId) as ContributionRow[];
}

export function insertContribution(
  userId: number,
  goalId: number,
  date: string,
  amountKurus: number,
  note: string | null,
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO savings_contributions (user_id, goal_id, date, amount_kurus, note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, goalId, date, amountKurus, note);
  return Number(result.lastInsertRowid);
}

export function deleteContribution(userId: number, goalId: number, id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM savings_contributions WHERE user_id = ? AND goal_id = ? AND id = ?')
    .run(userId, goalId, id);
  return Number(result.changes) > 0;
}
