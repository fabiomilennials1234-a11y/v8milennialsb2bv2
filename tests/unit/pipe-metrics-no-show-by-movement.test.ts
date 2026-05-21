/**
 * No-show now triggered by card movement (remarcar/perdido) regardless of
 * meeting_date. Denominator scopes to finalised stages.
 */

import { describe, it, expect } from "vitest";
import { computeConfirmacaoStats } from "../../src/hooks/usePipeMetrics";

const noopOverdue = () => false;
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe("computeConfirmacaoStats — no-show by movement", () => {
  it("counts perdido moved before meeting_date as no-show", () => {
    const stats = computeConfirmacaoStats(
      [{ status: "perdido", meeting_date: tomorrow() }],
      noopOverdue,
    );
    expect(stats.perdido).toBe(1);
    expect(stats.noShowRate).toBe(100);
  });

  it("counts remarcar moved before meeting_date as no-show", () => {
    const stats = computeConfirmacaoStats(
      [{ status: "remarcar", meeting_date: tomorrow() }],
      noopOverdue,
    );
    expect(stats.remarcar).toBe(1);
    expect(stats.noShowRate).toBe(100);
  });

  it("counts perdido moved after meeting_date as no-show", () => {
    const stats = computeConfirmacaoStats(
      [{ status: "perdido", meeting_date: yesterday() }],
      noopOverdue,
    );
    expect(stats.noShowRate).toBe(100);
  });

  it("compareceu does NOT count as no-show but counts in denominator", () => {
    const stats = computeConfirmacaoStats(
      [
        { status: "compareceu", meeting_date: yesterday() },
        { status: "perdido", meeting_date: tomorrow() },
      ],
      noopOverdue,
    );
    expect(stats.noShowRate).toBe(50);
    expect(stats.showRate).toBe(50);
  });

  it("non-finalised stages (marcada, d-5) excluded from denominator", () => {
    const stats = computeConfirmacaoStats(
      [
        { status: "marcada", meeting_date: tomorrow() },
        { status: "d-5", meeting_date: tomorrow() },
        { status: "perdido", meeting_date: tomorrow() },
      ],
      noopOverdue,
    );
    // Only perdido in denominator → 100%
    expect(stats.noShowRate).toBe(100);
  });

  it("rate is 0 when no finalised meetings", () => {
    const stats = computeConfirmacaoStats(
      [
        { status: "marcada", meeting_date: tomorrow() },
        { status: "d-3", meeting_date: tomorrow() },
      ],
      noopOverdue,
    );
    expect(stats.noShowRate).toBe(0);
    expect(stats.showRate).toBe(0);
  });

  it("rate stays in [0,100] when remarcar+perdido outnumber compareceu", () => {
    const stats = computeConfirmacaoStats(
      [
        { status: "compareceu", meeting_date: yesterday() },
        { status: "remarcar", meeting_date: tomorrow() },
        { status: "perdido", meeting_date: tomorrow() },
        { status: "perdido", meeting_date: tomorrow() },
      ],
      noopOverdue,
    );
    expect(stats.noShowRate).toBe(75);
    expect(stats.noShowRate).toBeLessThanOrEqual(100);
  });
});
