/**
 * Public barrel for `src/components/chat/`.
 *
 * External consumers (pages, other feature modules) MUST import from here,
 * not from deep internal paths. Internal cross-folder imports within `chat/`
 * may use relative paths.
 *
 * Updated incrementally as components are extracted into sub-folders
 * (Onda 2a commits C1–C17).
 */

// Page / shell
export { WhatsAppChat } from "./WhatsAppChat";

// Message primitives (consumed by EmbeddedChatWindow + future reuse)
export { MessageBubble } from "./WhatsAppChat";
export { AudioRecorder } from "./WhatsAppChat";
export { ImagePreviewModal } from "./WhatsAppChat";
export { MessagesAreaErrorBoundary } from "./WhatsAppChat";

// Media primitives (C2+)
export { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";

// Helpers (consumed by EmbeddedChatWindow and external code)
export { formatMessageTime } from "./WhatsAppChat";
export { MessageStatusIcon } from "./WhatsAppChat";

// Onda 1 primitives
export { ChatEmptyState } from "./ChatEmptyState";
export { ScrollToBottomFab } from "./ScrollToBottomFab";
export { UnreadDivider } from "./UnreadDivider";
