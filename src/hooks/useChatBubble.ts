/**
 * useChatBubble — consumer do ChatBubbleContext.
 *
 * Throw quando chamado fora de <ChatBubbleProvider>. Use o hook seguro
 * `useChatBubbleOptional()` quando o caller pode estar fora do provider
 * (ex: rotas que não têm Bubble montado — o hook retorna null em vez de throw).
 */
import { useContext } from "react";
import {
  ChatBubbleContext,
  type ChatBubbleContextValue,
} from "@/contexts/ChatBubbleContext";

export function useChatBubble(): ChatBubbleContextValue {
  const ctx = useContext(ChatBubbleContext);
  if (!ctx) {
    throw new Error(
      "useChatBubble must be used inside <ChatBubbleProvider>. Adicione o provider em MainLayout ou use useChatBubbleOptional()",
    );
  }
  return ctx;
}

export function useChatBubbleOptional(): ChatBubbleContextValue | null {
  return useContext(ChatBubbleContext);
}
