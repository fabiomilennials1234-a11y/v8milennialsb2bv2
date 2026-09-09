import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import { ChatReplyProvider, ReplyPreview } from "./ReplyContext";
import { MessageBubbleActions } from "./actions/MessageBubbleActions";
import type { WhatsAppMessage } from "../../hooks/chat/types";
vi.mock("@/modules/communication/hooks/useMessageActions", () => {
  const hook = () => ({ mutateAsync: vi.fn(), isPending: false });
  return { useReactMessage: hook, useEditMessage: hook, usePinMessage: hook, useDeleteMessage: hook, useMarkMessageRead: hook, useDownloadMedia: hook, isFeatureUnavailable: () => false };
});
vi.mock("@/modules/communication/hooks/useInstanceCapabilities", () => ({ useInstanceCapabilities: () => ({ canUseUazapiActions: true }) }));
vi.mock("./actions/EmojiPickerPopover", () => ({ EmojiPickerPopover: () => null }));
vi.mock("./actions/DeleteMessageConfirm", () => ({ DeleteMessageConfirm: () => null }));
const original = { message_id: "original", status: "delivered", content: "Mensagem original", direction: "incoming", message_type: "text" } as WhatsAppMessage;
function Chat({ conversation = "one", message = original }: { conversation?: string; message?: WhatsAppMessage }) {
  return <ChatReplyProvider key={conversation} messages={[message]}><MessageBubbleActions instanceId="box" messageId="original" number="5551999999999" direction="incoming" canEdit={false} canDelete={false} isPinned={false} onRequestEdit={() => {}} /><ReplyPreview /></ChatReplyProvider>;
}
it("selects the actual message action, previews and cancels the quote", async () => {
  render(<Chat />); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Responder mensagem" }));
  expect(screen.getByText("Mensagem original")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancelar resposta" }));
  expect(screen.queryByText("Mensagem original")).not.toBeInTheDocument();
});
it("does not carry the quote into another conversation", async () => {
  const { rerender } = render(<Chat />);
  await userEvent.click(screen.getByRole("button", { name: "Responder mensagem" }));
  rerender(<Chat conversation="two" />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("does not quote a failed send", async () => {
  render(<Chat message={{ ...original, status: "failed" }} />);
  await userEvent.click(screen.getByRole("button", { name: "Responder mensagem" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
