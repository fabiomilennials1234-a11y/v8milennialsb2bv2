import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ─── Mock Supabase client ────────────────────────────────
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: mockUpsert,
      delete: mockDelete,
    })),
  },
}));

// ─── Mock Auth ───────────────────────────────────────────
const mockUseAuth = vi.fn(() => ({
  user: { id: 'user-1' },
  organizationId: 'org-1',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ─── Mock VAPID key ─────────────────────────────────────
// Valid base64url VAPID public key (65 bytes = uncompressed EC P-256 point)
vi.stubEnv(
  'VITE_VAPID_PUBLIC_KEY',
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzknnwUGJkQ5cbbMh9Y2qSFdMB24Vj8AcfNOqJuBnbA',
);

// ─── Helpers ────────────────────────────────────────────
const originalNotification = globalThis.Notification;
const originalServiceWorker = navigator.serviceWorker;

function installNotificationMock(permission: NotificationPermission = 'default') {
  Object.defineProperty(globalThis, 'Notification', {
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue('granted'),
    },
    writable: true,
    configurable: true,
  });
}

const mockGetSubscription = vi.fn().mockResolvedValue(null);
const mockSubscribe = vi.fn().mockResolvedValue({
  endpoint: 'https://push.example.com/sub/123',
  getKey: (name: string) => {
    const keys: Record<string, Uint8Array> = {
      p256dh: new Uint8Array([1, 2, 3]),
      auth: new Uint8Array([4, 5, 6]),
    };
    return keys[name] ?? null;
  },
  unsubscribe: vi.fn().mockResolvedValue(true),
  toJSON: () => ({
    endpoint: 'https://push.example.com/sub/123',
    keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
  }),
});

function installServiceWorkerMock() {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({
        pushManager: {
          subscribe: mockSubscribe,
          getSubscription: mockGetSubscription,
        },
      }),
    },
    writable: true,
    configurable: true,
  });
}

function removeNotificationMock() {
  // Simulate browser without Notification API
  Object.defineProperty(globalThis, 'Notification', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

function removeServiceWorkerMock() {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ─── Import under test ──────────────────────────────────
// Lazy import to allow mocks to settle
let usePushSubscription: typeof import('@/hooks/use-push-subscription').usePushSubscription;

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSubscription.mockResolvedValue(null);
  // Fresh import each test to avoid stale module state
  const mod = await import('@/hooks/use-push-subscription');
  usePushSubscription = mod.usePushSubscription;
});

afterEach(() => {
  // Restore originals
  Object.defineProperty(globalThis, 'Notification', {
    value: originalNotification,
    writable: true,
    configurable: true,
  });
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: originalServiceWorker,
      writable: true,
      configurable: true,
    });
  }
});

// ─── Cycle 1: isSupported detection ─────────────────────
describe('usePushSubscription', () => {
  describe('Cycle 1 — isSupported detection', () => {
    it('returns isSupported=false when Notification API not available', () => {
      removeNotificationMock();
      removeServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.isSupported).toBe(false);
    });

    it('returns isSupported=false when ServiceWorker not available', () => {
      installNotificationMock('default');
      removeServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.isSupported).toBe(false);
    });

    it('returns isSupported=true when both Notification and ServiceWorker available', () => {
      installNotificationMock('default');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.isSupported).toBe(true);
    });
  });

  // ─── Cycle 2: permission state ──────────────────────────
  describe('Cycle 2 — permission state', () => {
    it('returns permission="default" when not yet prompted', () => {
      installNotificationMock('default');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.permission).toBe('default');
    });

    it('returns permission="granted" when already granted', () => {
      installNotificationMock('granted');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.permission).toBe('granted');
    });

    it('returns permission="denied" when denied', () => {
      installNotificationMock('denied');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.permission).toBe('denied');
    });
  });

  // ─── Cycle 3: requestPermission ─────────────────────────
  describe('Cycle 3 — requestPermission', () => {
    it('calls Notification.requestPermission and updates state to granted', async () => {
      installNotificationMock('default');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.permission).toBe('default');

      await act(async () => {
        await result.current.requestPermission();
      });

      expect(globalThis.Notification.requestPermission).toHaveBeenCalledOnce();
      expect(result.current.permission).toBe('granted');
      expect(result.current.isSubscribed).toBe(true);
    });

    it('updates permission to denied when user denies', async () => {
      installNotificationMock('default');
      installServiceWorkerMock();

      (globalThis.Notification.requestPermission as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('denied');

      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.requestPermission();
      });

      expect(result.current.permission).toBe('denied');
      expect(result.current.isSubscribed).toBe(false);
    });

    it('does nothing when API not supported', async () => {
      removeNotificationMock();
      removeServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.requestPermission();
      });

      expect(result.current.isSubscribed).toBe(false);
    });
  });

  // ─── Cycle 4: subscribe flow + Supabase persistence ────
  describe('Cycle 4 — subscribe + persist', () => {
    it('creates push subscription and saves to Supabase after permission granted', async () => {
      installNotificationMock('default');
      installServiceWorkerMock();

      const { result } = renderHook(() => usePushSubscription());

      await act(async () => {
        await result.current.requestPermission();
      });

      // pushManager.subscribe called with correct VAPID key
      expect(mockSubscribe).toHaveBeenCalledOnce();
      expect(mockSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          userVisibleOnly: true,
          applicationServerKey: expect.any(Uint8Array),
        }),
      );

      // Supabase upsert called with subscription data
      const { supabase } = await import('@/integrations/supabase/client');
      expect(supabase.from).toHaveBeenCalledWith('push_subscriptions');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          organization_id: 'org-1',
          endpoint: 'https://push.example.com/sub/123',
        }),
        expect.objectContaining({
          onConflict: 'endpoint',
        }),
      );

      expect(result.current.isSubscribed).toBe(true);
    });

    it('detects existing subscription on mount when permission already granted', async () => {
      installNotificationMock('granted');
      installServiceWorkerMock();

      const existingSub = {
        endpoint: 'https://push.example.com/existing',
        unsubscribe: vi.fn().mockResolvedValue(true),
        getKey: () => new Uint8Array([1]),
        toJSON: () => ({
          endpoint: 'https://push.example.com/existing',
          keys: { p256dh: 'k', auth: 'a' },
        }),
      };
      mockGetSubscription.mockResolvedValueOnce(existingSub);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.isSubscribed).toBe(true);
      });
    });

    it('unsubscribe removes subscription from browser and Supabase', async () => {
      installNotificationMock('granted');
      installServiceWorkerMock();

      const mockUnsubscribeFn = vi.fn().mockResolvedValue(true);
      const existingSub = {
        endpoint: 'https://push.example.com/existing',
        unsubscribe: mockUnsubscribeFn,
        getKey: () => new Uint8Array([1]),
        toJSON: () => ({
          endpoint: 'https://push.example.com/existing',
          keys: { p256dh: 'k', auth: 'a' },
        }),
      };
      mockGetSubscription.mockResolvedValueOnce(existingSub);

      const { result } = renderHook(() => usePushSubscription());

      await waitFor(() => {
        expect(result.current.isSubscribed).toBe(true);
      });

      await act(async () => {
        await result.current.unsubscribe();
      });

      expect(mockUnsubscribeFn).toHaveBeenCalledOnce();
      expect(mockDelete).toHaveBeenCalled();
      expect(result.current.isSubscribed).toBe(false);
    });
  });

  // ─── Edge: no user / no org ─────────────────────────────
  describe('Edge — no auth', () => {
    it('does not check subscription when user is null', () => {
      installNotificationMock('granted');
      installServiceWorkerMock();
      mockUseAuth.mockReturnValueOnce({ user: null, organizationId: null } as any);

      const { result } = renderHook(() => usePushSubscription());

      expect(result.current.isSubscribed).toBe(false);
      expect(mockGetSubscription).not.toHaveBeenCalled();
    });
  });
});
