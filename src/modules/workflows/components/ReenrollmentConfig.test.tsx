import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReenrollmentConfig } from './ReenrollmentConfig';

describe('ReenrollmentConfig', () => {
  it('shows unlimited reentry instead of legacy limits when enabled', () => {
    render(<ReenrollmentConfig value={{ enabled: true, max_times: 1, cooldown_days: 30 }} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByText(/sem limite de quantidade nem intervalo de dias/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /reinscrição/i })).toBeChecked();
  });
  it('toggles the operational setting without rewriting legacy compatibility fields', () => {
    const onChange = vi.fn();
    render(<ReenrollmentConfig value={{ enabled: false, max_times: 1, cooldown_days: 30 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /reinscrição/i }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, max_times: 1, cooldown_days: 30 });
  });
  it('can disable reentry again', () => {
    const onChange = vi.fn();
    render(<ReenrollmentConfig value={{ enabled: true, max_times: 4, cooldown_days: 9 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: /reinscrição/i }));
    expect(onChange).toHaveBeenCalledWith({ enabled: false, max_times: 4, cooldown_days: 9 });
  });
});
