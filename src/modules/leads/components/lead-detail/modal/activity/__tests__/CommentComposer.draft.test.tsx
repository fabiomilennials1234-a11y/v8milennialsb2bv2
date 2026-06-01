import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommentComposer } from "../CommentComposer";

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

const createMutateAsync = vi.fn().mockResolvedValue({});
vi.mock("../../../hooks/useLeadComments", () => ({
  useCreateLeadComment: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function renderComposer(leadId = "lead-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommentComposer leadId={leadId} organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const KEY = "lead-comment-draft:user-1:lead-1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  createMutateAsync.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CommentComposer draft persistence (issue #313)", () => {
  it("restores draft from localStorage on mount", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ body: "rascunho antigo", savedAt: Date.now() }),
    );
    renderComposer();
    const textarea = screen.getByTestId("comment-composer-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("rascunho antigo");
  });

  it("ignores draft older than 7 days TTL", () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      KEY,
      JSON.stringify({ body: "expirado", savedAt: eightDaysAgo }),
    );
    renderComposer();
    const textarea = screen.getByTestId("comment-composer-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    // expired entry purged on read
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("saves draft to localStorage debounced 500ms after typing", () => {
    renderComposer();
    const textarea = screen.getByTestId("comment-composer-textarea");
    fireEvent.change(textarea, { target: { value: "novo rascunho" } });
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.body).toBe("novo rascunho");
  });

  it("clears draft on successful submit", async () => {
    vi.useRealTimers();
    renderComposer();
    const textarea = screen.getByTestId("comment-composer-textarea");
    fireEvent.change(textarea, { target: { value: "vai enviar" } });
    await waitFor(() => {
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  it("scopes draft per (userId, leadId)", () => {
    renderComposer("lead-A");
    const tA = screen.getByTestId("comment-composer-textarea");
    fireEvent.change(tA, { target: { value: "draft do lead A" } });
    act(() => { vi.advanceTimersByTime(500); });
    expect(localStorage.getItem("lead-comment-draft:user-1:lead-A")).toBeTruthy();
    expect(localStorage.getItem("lead-comment-draft:user-1:lead-B")).toBeNull();
  });
});
