import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockUseGestor = vi.fn();
const mockNavigate = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/modules/identity/gestor/hooks/useGestor', () => ({
  useGestor: (...args: unknown[]) => mockUseGestor(...args),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('lucide-react', () => ({
  Loader2: ({ className }: { className?: string }) => <span data-testid="loader2" className={className} />,
  ShieldAlert: ({ className }: { className?: string }) => <span data-testid="shield-alert" className={className} />,
}));

import { GestorRoute } from '@/modules/identity/gestor/components/GestorRoute';

describe('GestorRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loader while gestor status is loading', () => {
    mockUseGestor.mockReturnValue({ isGestor: false, isLoading: true });

    render(<GestorRoute><p>gestor-area</p></GestorRoute>);

    expect(screen.getByTestId('loader2')).toBeInTheDocument();
    expect(screen.queryByText('gestor-area')).not.toBeInTheDocument();
  });

  it('denies non-gestor: shows access-denied and redirects home', () => {
    mockUseGestor.mockReturnValue({ isGestor: false, isLoading: false });

    render(<GestorRoute><p>gestor-area</p></GestorRoute>);

    expect(screen.getByText('Acesso Negado')).toBeInTheDocument();
    expect(screen.queryByText('gestor-area')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mockToastError).toHaveBeenCalled();
  });

  it('renders children for an active gestor', () => {
    mockUseGestor.mockReturnValue({ isGestor: true, isLoading: false });

    render(<GestorRoute><p>gestor-area</p></GestorRoute>);

    expect(screen.getByText('gestor-area')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
