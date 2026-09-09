import { ChatReplyContext, useChatReply } from "../../hooks/chat/useChatReply";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { WhatsAppMessage, ReplyContext as ReplyTarget } from "../../hooks/chat/types";

export function ChatReplyProvider({ messages, children }: { messages: WhatsAppMessage[]; children: ReactNode }) {
  const [target, setTarget] = useState<ReplyTarget | null>(null);
  return <ChatReplyContext.Provider value={{ target, select: id => {
    const message = messages.find(m => m.message_id === id);
    if (!message || ["pending", "failed"].includes(message.status) || /^(local_|optimistic_)/.test(id)) return;
    setTarget({ messageId: id, text: message.content?.trim() || ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[message.message_type] ?? "Mensagem"), direction: message.direction });
  }, clear: id => setTarget(current => !id || current?.messageId === id ? null : current) }}>{children}</ChatReplyContext.Provider>;
}


export function ReplyPreview() {
  const reply = useChatReply();
  if (!reply?.target) return null;
  return <div role="status" className="flex items-center gap-2 m-2 border-l-2 border-primary rounded bg-muted/60 p-2">
    <div className="min-w-0 flex-1"><p className="text-xs font-medium text-primary">Respondendo {reply.target.direction === "outgoing" ? "a você" : "ao contato"}</p><p className="text-sm truncate">{reply.target.text}</p></div>
    <button type="button" aria-label="Cancelar resposta" className="p-2" onClick={() => reply.clear()}><X className="h-4 w-4" /></button>
  </div>;
}
