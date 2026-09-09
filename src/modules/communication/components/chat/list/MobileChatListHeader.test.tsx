import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MobileChatListHeader } from "./MobileChatListHeader";

it("offers Nova Conversa on mobile even with no conversations or unread messages", () => {
  const onNewConversation = vi.fn();
  render(<MobileChatListHeader instanceName="Vendas" instanceConnected
    onOpenInstanceSelector={vi.fn()} searchQuery="" onSearchChange={vi.fn()}
    activeFilter="all" onFilterChange={vi.fn()} unreadCount={0}
    vendorFilter="all" onVendorFilterChange={vi.fn()} vendorOptions={[]}
    currentTeamMemberId="me" canSeeUnassigned onNewConversation={onNewConversation} />);
  fireEvent.click(screen.getByRole("button", { name: "Nova Conversa" }));
  expect(onNewConversation).toHaveBeenCalledOnce();
});
