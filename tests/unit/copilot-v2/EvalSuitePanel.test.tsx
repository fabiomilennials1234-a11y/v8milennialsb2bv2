/**
 * Slice 9 — EvalSuitePanel (T9). Clicking "Rodar eval-suite" fires the hook and
 * renders PASS/FAIL/SKIP per case. Hook mocked.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EvalSuitePanel } from '../../../src/modules/copilot/components/v2-wizard/EvalSuitePanel';

const mutate = vi.fn();
const data = {
  summary: { total: 3, pass: 1, fail: 1, skip: 1, error: 0 },
  results: [
    { caseId: '1', caseName: 'caso ouro', archetype: 'qualificador', status: 'pass', expected: {}, actual: {}, reasoning: '' },
    { caseId: '2', caseName: 'caso ruim', archetype: 'qualificador', status: 'fail', expected: {}, actual: {}, reasoning: 'expected ouro, got prata' },
    { caseId: '3', caseName: 'caso pulado', archetype: 'carteira', status: 'skip', expected: {}, actual: {}, reasoning: 'deferred' },
  ],
};
vi.mock('../../../src/modules/copilot/hooks/useCopilotV2Simulator', () => ({
  useRunEvalSuite: () => ({ mutate, isPending: false, data, isError: false }),
}));

describe('EvalSuitePanel', () => {
  it('fires the run mutation for the archetype on click', () => {
    render(<EvalSuitePanel archetype="qualificador" />);
    fireEvent.click(screen.getByRole('button', { name: /Rodar eval-suite/i }));
    expect(mutate).toHaveBeenCalledWith({ archetype: 'qualificador' });
  });

  it('renders a row per case with its status', () => {
    render(<EvalSuitePanel archetype="qualificador" />);
    expect(screen.getByText('caso ouro')).toBeInTheDocument();
    expect(screen.getByText('caso ruim')).toBeInTheDocument();
    expect(screen.getByText('1 pass')).toBeInTheDocument();
    expect(screen.getByText('1 fail')).toBeInTheDocument();
  });
});
