/**
 * BuilderPanel
 *
 * Docked side panel where the user converses with the Copilot Builder while
 * the Playground form fills live beside it. Each turn sends the capability
 * tool-defs; the Builder's tool-calls come back as actions that the parent
 * applies to the form. (PRD #544 / #545 + #547 wiring)
 */

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBuilderSession } from "@/hooks/useBuilderSession";

interface BuilderPanelProps {
  agentId?: string;
  /** Function-calling defs derived from the capability manifest. */
  toolDefs: unknown[];
  /** Apply the Builder's tool-calls to the live form. */
  onApplyActions: (actions: unknown[]) => void;
  onClose?: () => void;
}

export function BuilderPanel({ agentId, toolDefs, onApplyActions, onClose }: BuilderPanelProps) {
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
    sendMessage.mutate(
      { message: text, toolDefs },
      { onSuccess: (res) => onApplyActions(res.actions) },
    );
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Criar com IA</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            <Bot className="h-8 w-8 text-primary/70" />
            <p>Diga o que esse Copilot precisa fazer. Eu monto os campos com você.</p>
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
          <Button size="icon" onClick={handleSend} disabled={sending || !draft.trim() || !agentId}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </aside>
  );
}
