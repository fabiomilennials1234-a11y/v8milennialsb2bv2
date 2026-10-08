import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';

const sw = vi.hoisted(() => ({ signal: undefined as undefined | (() => void), update: vi.fn() }));
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh: () => void }) => {
    sw.signal = options.onNeedRefresh;
    return sw.update;
  },
}));
import { useServiceWorkerUpdate } from '@/modules/platform/hooks/use-sw-update';

function DraftEditor() {
  useServiceWorkerUpdate();
  const [draft, setDraft] = useState('');
  return <textarea aria-label="Proposta em edição" value={draft} onChange={e => setDraft(e.target.value)} />;
}

const originalLocation = window.location;
beforeEach(() => {
  vi.useFakeTimers();
  sw.update.mockClear();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(window, 'location', { value: { ...originalLocation, reload: vi.fn() }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
});

it('preserves an unfinished proposal when an update arrives and the user switches tabs', () => {
  const view = render(<DraftEditor />);
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Proposta ainda não salva' } });
  act(() => sw.signal?.());
  act(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(3_000);
  });
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(sw.update).not.toHaveBeenCalled();
});

it('preserves an unfinished proposal after two minutes without typing', () => {
  const view = render(<DraftEditor />);
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Proposta ainda não salva' } });
  act(() => sw.signal?.());
  act(() => vi.advanceTimersByTime(123_000));
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(sw.update).not.toHaveBeenCalled();
});
