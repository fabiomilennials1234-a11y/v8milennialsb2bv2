import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncProgressCard } from "../../src/modules/communication/components/chat/history-sync/SyncProgressCard";
import type { HistorySyncJob } from "../../src/modules/communication/hooks/useHistorySyncJobs";
vi.mock("@/modules/communication/hooks/useHistorySyncJobs", () => ({ useControlHistorySyncJob: () => ({ isPending: false }) }));
afterEach(cleanup);
const job = { status: "running", scope: "chat", total_fetched: 205, total_chats: null, started_at: null, completed_at: null } as HistorySyncJob;
describe("history import progress", () => {
  it("does not invent a percentage when total is unknown", () => {
    render(<SyncProgressCard job={job} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Aguardando total");
    expect(screen.getByText("205 mensagens")).toBeTruthy();
  });
  it("counts skipped chats as processed", () => {
    render(<SyncProgressCard job={{ ...job, total_chats: 10, chats_completed: 4, chats_skipped: 2 }} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
  });
  it("shows completion without an active progress indicator", () => {
    render(<SyncProgressCard job={{ ...job, status: "completed" }} />);
    expect(screen.getByText("Concluído")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
