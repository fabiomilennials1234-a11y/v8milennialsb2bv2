/**
 * useSaleValueGuard — orchestrates the "value before won" gate (D1 / SQL-I3).
 *
 * DRY entry point for every human-driven won-transition path (kanban drag,
 * intercept dialogs, stage dropdowns). Holds no rule of its own — it delegates
 * the decision to `shouldPromptForSaleValue` and only manages the deferred
 * action + modal open state.
 *
 * Contract: call `guardWonTransition({ targetStageKey, currentValue, proceed })`.
 *  · Not a won move, or value already usable → runs `proceed()` immediately.
 *  · Won move without a usable value → defers `proceed`, opens the modal, and
 *    runs `proceed(enteredValue)` only after the user confirms. `proceed` must
 *    thread `enteredValue` into the SAME mutation that writes the won stage_key,
 *    so `fn_capture_sale_event` snapshots it.
 */

import { useCallback, useState } from "react";
import { shouldPromptForSaleValue, type WonStageResolvable } from "../lib/sale-value-guard";

export interface GuardWonTransitionArgs {
  /** Target stage_key the entry is moving into. */
  targetStageKey: string;
  /** Effective value already known for the entry (metadata or items sum). */
  currentValue: unknown;
  /**
   * Perform the move. Receives the user-entered value when the modal was shown,
   * or `undefined` when the value was already present (caller keeps existing).
   */
  proceed: (saleValueOverride?: number) => void;
}

export interface UseSaleValueGuardResult {
  /** Gate a transition. Returns true if it proceeded synchronously. */
  guardWonTransition: (args: GuardWonTransitionArgs) => boolean;
  /** Whether the required-value modal is currently open. */
  saleValueModalOpen: boolean;
  /** Confirm handler for the modal — resumes the deferred move with `value`. */
  confirmSaleValue: (value: number) => void;
  /** Cancel handler — drops the deferred move; the card does NOT move. */
  cancelSaleValue: () => void;
}

export function useSaleValueGuard(
  stages: readonly WonStageResolvable[] | null | undefined,
): UseSaleValueGuardResult {
  // Stored as a state holding the resume callback. Wrapped in an object so a
  // function value isn't mistaken for a state updater.
  const [pending, setPending] = useState<{ resume: (value: number) => void } | null>(null);

  const guardWonTransition = useCallback(
    ({ targetStageKey, currentValue, proceed }: GuardWonTransitionArgs): boolean => {
      if (shouldPromptForSaleValue(targetStageKey, currentValue, stages)) {
        setPending({
          resume: (value: number) => {
            setPending(null);
            proceed(value);
          },
        });
        return false;
      }
      proceed();
      return true;
    },
    [stages],
  );

  const confirmSaleValue = useCallback(
    (value: number) => {
      if (pending) pending.resume(value);
    },
    [pending],
  );

  const cancelSaleValue = useCallback(() => setPending(null), []);

  return {
    guardWonTransition,
    saleValueModalOpen: pending !== null,
    confirmSaleValue,
    cancelSaleValue,
  };
}
