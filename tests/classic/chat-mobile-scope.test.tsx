import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MobileChatListHeader } from "@/modules/communication/components/chat/list/MobileChatListHeader";

it("offers Nova Conversa on mobile even with no conversations or unread messages", () => {
  const onNewConversation = vi.fn();
  render(<MobileChatListHeader instanceName="Vendas" instanceConnected
    onOpenInstanceSelector={vi.fn()} searchQuery="" onSearchChange={vi.fn()}
    activeFilter="all" onFilterChange={vi.fn()} unreadCount={0}
    vendorFilter="all" onVendorFilterChange={vi.fn()} vendorOptions={[]}
    currentTeamMemberId="me" canSeeUnassigned canFilterOtherVendors onNewConversation={onNewConversation} />);
  fireEvent.click(screen.getByRole("button", { name: "Nova Conversa" }));
  expect(onNewConversation).toHaveBeenCalledOnce();
});

it("does not offer other sellers to a member restricted to their own conversations", () => {
  render(<MobileChatListHeader instanceName="WhatsApp Principal" instanceConnected
    onOpenInstanceSelector={vi.fn()} searchQuery="" onSearchChange={vi.fn()}
    activeFilter="all" onFilterChange={vi.fn()} unreadCount={0}
    vendorFilter="mine" onVendorFilterChange={vi.fn()}
    vendorOptions={[{ id: "alesson", name: "Alesson Lopes Morais" }, { id: "rafael", name: "Rafael Roessler" }]}
    currentTeamMemberId="ivan" canSeeUnassigned={false} canFilterOtherVendors={false} />);
  expect(screen.queryByRole("combobox", { name: "Filtrar por vendedor" })).not.toBeInTheDocument();
  expect(screen.getByText("Minhas conversas")).toBeInTheDocument();
});
