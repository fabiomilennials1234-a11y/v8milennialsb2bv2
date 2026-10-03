import { createContext, useContext } from "react";
import type { ReplyContext } from "./types";
export const ChatReplyContext = createContext<{
  target: ReplyContext | null;
  select: (messageId: string) => void;
  clear: (messageId?: string) => void;
} | null>(null);
export const useChatReply = () => useContext(ChatReplyContext);
