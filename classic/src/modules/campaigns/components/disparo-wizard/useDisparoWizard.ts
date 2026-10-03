/**
 * useDisparoWizard — thin React shell over the pure `wizard-machine` (#904).
 *
 * All gating/navigation logic is pure and unit-tested in `wizard-machine.ts`;
 * this hook just hosts it in a `useReducer` and exposes ergonomic helpers for
 * the Wizard Linear shell.
 */
import { useReducer, useMemo, useCallback } from "react";
import {
  createInitialState,
  wizardReducer,
  canAdvance,
  validateStep,
  DISPARO_STEPS,
  LAST_STEP_INDEX,
  type DisparoDraft,
  type DisparoNumber,
  type DisparoStepId,
} from "./wizard-machine";

export function useDisparoWizard(
  startDateIso: string,
  numbers: DisparoNumber[] = [],
) {
  const [state, dispatch] = useReducer(
    wizardReducer,
    undefined,
    () => createInitialState(startDateIso, numbers),
  );

  const currentStep = DISPARO_STEPS[state.index];
  const validation = useMemo(
    () => validateStep(currentStep.id, state.draft),
    [currentStep.id, state.draft],
  );

  const patch = useCallback(
    (p: Partial<DisparoDraft>) => dispatch({ type: "PATCH", patch: p }),
    [],
  );

  return {
    state,
    draft: state.draft,
    index: state.index,
    furthest: state.furthest,
    stepId: currentStep.id as DisparoStepId,
    steps: DISPARO_STEPS,
    isFirst: state.index === 0,
    isLast: state.index === LAST_STEP_INDEX,
    isReview: currentStep.id === "review",
    isMonitor: currentStep.id === "monitor",
    canAdvance: canAdvance(state),
    blockReason: validation.ok ? null : validation.reason,
    patch,
    next: useCallback(() => dispatch({ type: "NEXT" }), []),
    back: useCallback(() => dispatch({ type: "BACK" }), []),
    goTo: useCallback((i: number) => dispatch({ type: "GOTO", index: i }), []),
    release: useCallback(() => dispatch({ type: "RELEASE" }), []),
  };
}
