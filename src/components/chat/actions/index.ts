/**
 * Barrel — export dos componentes de ações de mensagem Sprint 1.
 *
 * Consumo no MessageBubble:
 *
 *   import {
 *     MessageBubbleActions,
 *     MessageMetaBadges,
 *     DeletedPlaceholder,
 *     EditMessageInline,
 *   } from "@/components/chat/actions";
 */
export { MessageBubbleActions } from "./MessageBubbleActions";
export type { MessageBubbleActionsProps } from "./MessageBubbleActions";
export { MessageMetaBadges, DeletedPlaceholder } from "./MessageMetaBadges";
export { EditMessageInline } from "./EditMessageInline";
export { EmojiPickerPopover } from "./EmojiPickerPopover";
export { DeleteMessageConfirm } from "./DeleteMessageConfirm";
