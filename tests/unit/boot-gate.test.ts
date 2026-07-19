import { describe, it, expect } from 'vitest';
import { resolveBootRedirect, type BootState } from '@/modules/identity/auth/lib/boot-gate';

function state(overrides: Partial<BootState> = {}): BootState {
  return {
    authLoading: false,
    hasUser: true,
    gateLoading: false,
    isMaster: false,
    isGestor: false,
    ...overrides,
  };
}

describe('resolveBootRedirect — boot gate order (master → gestor → membro)', () => {
  it('auth loading → loading (no premature decision)', () => {
    expect(resolveBootRedirect(state({ authLoading: true }))).toEqual({ kind: 'loading' });
  });

  it('no user → landing', () => {
    expect(resolveBootRedirect(state({ hasUser: false }))).toEqual({ kind: 'landing' });
  });

  it('user present but actor gates loading → loading', () => {
    expect(resolveBootRedirect(state({ gateLoading: true }))).toEqual({ kind: 'loading' });
  });

  it('master → /dashboard (never /gestor)', () => {
    expect(resolveBootRedirect(state({ isMaster: true }))).toEqual({
      kind: 'redirect',
      to: '/dashboard',
    });
  });

  it('master wins over gestor (order: master first)', () => {
    // A user who is BOTH master and gestor lands in the app, not /gestor.
    expect(resolveBootRedirect(state({ isMaster: true, isGestor: true }))).toEqual({
      kind: 'redirect',
      to: '/dashboard',
    });
  });

  it('gestor (not master) → /gestor', () => {
    expect(resolveBootRedirect(state({ isGestor: true }))).toEqual({
      kind: 'redirect',
      to: '/gestor',
    });
  });

  it('plain member → /dashboard', () => {
    expect(resolveBootRedirect(state())).toEqual({ kind: 'redirect', to: '/dashboard' });
  });
});
