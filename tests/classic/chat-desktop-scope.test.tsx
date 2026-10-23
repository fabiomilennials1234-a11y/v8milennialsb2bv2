import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { InboxFilterBar } from "@/modules/communication/components/chat/list/InboxFilterBar";
import { DEFAULT_INBOX_FILTER } from "@/modules/communication/lib/inboxFilter";

it.each([false, true])("offers a seller filter only with server permission (%s)", async (allowed) => {
  render(<InboxFilterBar filter={DEFAULT_INBOX_FILTER} patch={vi.fn()} toggleMulti={vi.fn()}
    clearFilter={vi.fn()} unreadCount={0} waitingHumanCount={0} funnelOptions={[]}
    vendorOptions={[{ id: "other", name: "Other seller" }]} currentTeamMemberId="ivan"
    canSeeUnassigned={false} canFilterOtherVendors={allowed} allTags={[]} />);
  if (!allowed) expect(screen.getByText("Minhas conversas")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Filtro" }));
  expect(screen.queryByRole("button", { name: "Vendedor" }) !== null).toBe(allowed);
  expect(screen.getByRole("button", { name: "Funil" })).toBeInTheDocument();
});
