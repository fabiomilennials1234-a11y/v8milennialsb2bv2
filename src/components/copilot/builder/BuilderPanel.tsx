/**
 * BuilderPanel
 *
 * Side panel where the user converses with the Copilot Builder to build an
 * agent. Slice #545 is the skeleton round-trip: chat in, reply out, persisted
 * across visits. Live-fill of the Playground form arrives with #547.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBuilderSession } from "@/hooks/useBuilderSession";

interface BuilderPanelProps {
  agentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BuilderPanel({ agentId, open, onOpenChange }: BuilderPanelProps) {
  const { messages, isLoading, sendMessage } = useBuilderSession(agentId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const sending = sendMessage.isPending;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    sendMessage.mutate(text);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Criar com IA
          </SheetTitle>
          <SheetDescription className="text-xs">
            O assistente entrevista você e monta o Copilot.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
              <Bot className="h-8 w-8 text-primary/70" />
              <p>Diga o que esse Copilot precisa fazer e eu monto tudo com você.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                    m.role === "user"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
              ))}
              {sending && (
                <div className="self-start rounded-2xl bg-muted px-3.5 py-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Escreva aqui…"
              rows={1}
              className="max-h-32 min-h-[40px] resize-none"
              disabled={sending || !agentId}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sending || !draft.trim() || !agentId}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
