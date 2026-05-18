/**
 * Portfolio calculation utilities.
 * Pure functions mirroring SQL logic for testability.
 */

export interface ClientRecurringInput {
  avg_ticket: number | null;
  reorder_cycle_days: number | null;
}

export function calculateMonthlyRecurring(clients: ClientRecurringInput[]): number {
  return clients.reduce((sum, c) => {
    if (!c.avg_ticket) return sum;
    const cycle = Math.max(c.reorder_cycle_days ?? 30, 1);
    return sum + c.avg_ticket * (30 / cycle);
  }, 0);
}
