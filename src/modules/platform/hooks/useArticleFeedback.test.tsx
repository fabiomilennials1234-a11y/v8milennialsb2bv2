import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../tests/helpers/supabase-mock";
import { useArticleFeedback } from "./useArticleFeedback";

const authMock = vi.fn();
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: (...a: unknown[]) => authMock(...a),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

let mock: ReturnType<typeof createMockSupabase>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => (mock.sb as never as { from: (...x: unknown[]) => unknown }).from(...a),
  },
}));

const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const ART = "art-1";
const USER = "user-1";

beforeEach(() => {
  mock = createMockSupabase();
  mock.mockTable("help_article_feedback", []);
  authMock.mockReturnValue({ user: { id: USER } });
});

describe("useArticleFeedback", () => {
  it("sem voto anterior, myVote é null", async () => {
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.myVote).toBeNull());
  });

  it("com um 👍 gravado, myVote é true", async () => {
    mock.mockTable("help_article_feedback", [{ article_id: ART, user_id: USER, helpful: true }]);
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.myVote).toBe(true));
  });

  it("com um 👎 gravado, myVote é false", async () => {
    mock.mockTable("help_article_feedback", [{ article_id: ART, user_id: USER, helpful: false }]);
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await waitFor(() => expect(result.current.myVote).toBe(false));
  });

  it("submit(true) faz upsert com conflito em (article_id, user_id)", async () => {
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await act(async () => {
      await result.current.submitAsync({ helpful: true });
    });
    const rows = mock.getInserted("help_article_feedback");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ article_id: ART, user_id: USER, helpful: true });
    expect(mock.getUpsertOpts("help_article_feedback")[0]).toMatchObject({
      onConflict: "article_id,user_id",
    });
  });

  it("submit(false, motivo) grava helpful=false e o motivo", async () => {
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await act(async () => {
      await result.current.submitAsync({ helpful: false, reason: "faltou exemplo" });
    });
    expect(mock.getInserted("help_article_feedback")[0]).toMatchObject({
      helpful: false,
      reason: "faltou exemplo",
    });
  });

  it("um 👍 sempre limpa o motivo, mesmo se vier texto", async () => {
    const { result } = renderHook(() => useArticleFeedback(ART), { wrapper: wrap(newQc()) });
    await act(async () => {
      await result.current.submitAsync({ helpful: true, reason: "isso deveria sumir" });
    });
    expect(mock.getInserted("help_article_feedback")[0].reason).toBeNull();
  });
});
