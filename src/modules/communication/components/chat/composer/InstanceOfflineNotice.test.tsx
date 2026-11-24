import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InstanceOfflineNotice } from "./InstanceOfflineNotice";

const dead = vi.hoisted(() => ({ value: false }));
vi.mock("@/modules/communication/hooks/chat/useInstanceSessionDead", () => ({
  useInstanceSessionDead: () => dead.value,
}));

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Routes>
        <Route path="/chat" element={<InstanceOfflineNotice instanceId="inst-1" />} />
        <Route path="/configuracoes" element={<p>configurações</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InstanceOfflineNotice", () => {
  beforeEach(() => { dead.value = false; });

  it("renders nothing while the number is connected", () => {
    renderAt();
    expect(screen.queryByTestId("instance-offline-notice")).toBeNull();
  });

  it("warns that nothing will be sent and leads to the reconnect page", () => {
    dead.value = true;
    renderAt();
    expect(screen.getByRole("status")).toHaveTextContent("As mensagens não serão enviadas");
    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(screen.getByText("configurações")).toBeInTheDocument();
  });
});
