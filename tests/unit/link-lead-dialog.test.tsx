// tests/unit/link-lead-dialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const linkMutate = vi.fn();
vi.mock("@/modules/communication/hooks/chat-meta/useMetaLinkLead", () => ({
  useMetaLinkLead: () => ({ mutateAsync: linkMutate, isPending: false }),
}));

// useLeads(params) returns a react-query result; data is the leads array.
// Real signature: useLeads({ page?, searchQuery?, filterOrigin? }).
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useLeads: () => ({
    data: [{ id: "l1", name: "Alice", phone: "11999" }],
    isLoading: false,
  }),
}));

import { LinkLeadDialog } from "@/modules/communication/components/chat-meta/LinkLeadDialog";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("LinkLeadDialog", () => {
  it("vincula lead ao clicar", async () => {
    render(
      <LinkLeadDialog conversationId="c1" open onOpenChange={() => {}} />,
      { wrapper },
    );
    fireEvent.click(await screen.findByText("Alice"));
    expect(linkMutate).toHaveBeenCalledWith({
      conversationId: "c1",
      leadId: "l1",
    });
  });
});
