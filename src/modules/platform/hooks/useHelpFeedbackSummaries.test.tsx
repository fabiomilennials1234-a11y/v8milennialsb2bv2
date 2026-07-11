import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createMockSupabase } from "../../../../tests/helpers/supabase-mock";
import { useHelpFeedbackSummaries } from "./useHelpFeedbackSummaries";

let mock: ReturnType<typeof createMockSupabase>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => (mock.sb as never as { rpc: (...x: unknown[]) => unknown }).rpc(...a),
  },
}));

const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
const newQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  mock = createMockSupabase();
});

describe("useHelpFeedbackSummaries", () => {
  it("indexa o agregado do RPC por article_id", async () => {
    mock.mockRpc("get_help_article_feedback_summaries", [
      { article_id: "a1", helpful_up: 12, helpful_down: 3, reasons: ["faltou exemplo", "vídeo travou"] },
      { article_id: "a2", helpful_up: 5, helpful_down: 0, reasons: [] },
    ]);
    const { result } = renderHook(() => useHelpFeedbackSummaries(), { wrapper: wrap(newQc()) });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!["a1"]).toEqual({ up: 12, down: 3, reasons: ["faltou exemplo", "vídeo travou"] });
    expect(result.current.data!["a2"]).toEqual({ up: 5, down: 0, reasons: [] });
  });

  it("artigo sem feedback não aparece no mapa", async () => {
    mock.mockRpc("get_help_article_feedback_summaries", []);
    const { result } = renderHook(() => useHelpFeedbackSummaries(), { wrapper: wrap(newQc()) });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!["qualquer"]).toBeUndefined();
  });
});
