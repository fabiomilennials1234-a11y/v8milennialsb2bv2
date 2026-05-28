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
export { ChatShellWithContext } from "./ChatShellWithContext";

// Message primitives (public contract — used by chat components)
export { MessageBubble } from "./MessagePrimitives";
export { MessagesAreaErrorBoundary } from "./MessagePrimitives";

// Media primitives — sourced from dedicated files after C2/C3
export { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";
export { AudioRecorder } from "./media/AudioRecorder";
export { ImagePreviewModal } from "./media/ImagePreviewModal";
export { MessageImage, MessageVideo, MessageDocument } from "./media/MessageMedia";

// Helpers
export { formatMessageTime } from "./MessagePrimitives";
export { MessageStatusIcon } from "./MessagePrimitives";

// Onda 1 primitives
export { ChatEmptyState } from "./ChatEmptyState";
export { ScrollToBottomFab } from "./ScrollToBottomFab";
export { UnreadDivider } from "./UnreadDivider";
