// src/components/chat-meta/MetaComposer.tsx
import { useState, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMetaSend } from "@/hooks/chat-meta/useMetaSend";
import { isWithin24hWindow } from "@/hooks/chat-meta/types";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  conversationId: string;
  lastInboundAt: string | null | undefined;
}

// Project convention: chat media uploads target the `media` bucket
// (see TopNavigation, useCampaignTemplates, MessageTemplates, etc.).
const CHAT_MEDIA_BUCKET = "media";

export function MetaComposer({ conversationId, lastInboundAt }: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { mutateAsync, isPending } = useMetaSend();
  const canSend = isWithin24hWindow(lastInboundAt);

  async function handleSend() {
    if (!text.trim() || !canSend) return;
    try {
      await mutateAsync({ conversationId, text: text.trim() });
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar mensagem");
    }
  }

  async function handleImage(file: File) {
    if (!canSend) return;
    const path = `meta/${conversationId}/${Date.now()}-${file.name}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error || !data) {
      toast.error("Falha no upload");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pub } = (supabase as any).storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(data.path);
    try {
      await mutateAsync({ conversationId, mediaUrl: pub.publicUrl, mediaType: "image" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar imagem");
    }
  }

  return (
    <div className="border-t p-3">
      <input
        type="file"
        ref={fileRef}
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])}
      />
      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={!canSend || isPending}
        >
          <ImageIcon className="h-4 w-4" />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Escreva sua mensagem..."
          disabled={!canSend || isPending}
          className="min-h-[44px] max-h-[160px] resize-none"
        />
        <Button onClick={handleSend} disabled={!canSend || !text.trim() || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
