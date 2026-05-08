import { useState } from "react";
import { ChevronDown, ChevronUp, Paperclip, Reply, Forward, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEmailThread, type Email } from "@/hooks/useEmails";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface EmailThreadViewProps {
  threadId: string;
  onReply?: (email: Email) => void;
  onForward?: (email: Email) => void;
}

export function EmailThreadView({ threadId, onReply, onForward }: EmailThreadViewProps) {
  const { data: emails, isLoading } = useEmailThread(threadId);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!emails?.length) {
    return (
      <div className="text-center py-8">
        <Mail className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Nenhum email nesta thread.</p>
      </div>
    );
  }

  const subject = emails[0]?.subject || "(sem assunto)";

  return (
    <div className="space-y-0">
      <h3 className="text-base font-semibold mb-4 px-1">{subject}</h3>

      {emails.map((email, index) => {
        const isLast = index === emails.length - 1;
        const isExpanded = expandedIds.has(email.id) || isLast;

        return (
          <div
            key={email.id}
            className={cn(
              "border rounded-lg transition-colors",
              isExpanded ? "border-border" : "border-transparent hover:border-border/50",
              email.is_outbound && "bg-primary/[0.02]"
            )}
          >
            <button
              onClick={() => toggleExpanded(email.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                email.is_outbound ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {(email.from_name || email.from_address)?.[0]?.toUpperCase() || "?"}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {email.from_name || email.from_address}
                  </span>
                  {email.is_outbound && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">Enviado</Badge>
                  )}
                  {email.has_attachments && (
                    <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                  )}
                </div>
                {!isExpanded && email.snippet && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{email.snippet}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-muted-foreground">
                  {format(new Date(email.sent_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4">
                <div className="text-xs text-muted-foreground mb-3 space-y-0.5 ml-11">
                  <p>De: {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}</p>
                  <p>Para: {email.to_addresses.map((a: any) => a.name ? `${a.name} <${a.email}>` : a.email).join(", ")}</p>
                  {email.cc_addresses && email.cc_addresses.length > 0 && (
                    <p>Cc: {email.cc_addresses.map((a: any) => a.email).join(", ")}</p>
                  )}
                </div>

                <div
                  className="ml-11 prose prose-sm dark:prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{ __html: email.body_html || email.body_text || "" }}
                />

                {(email.open_count > 0 || email.click_count > 0) && (
                  <div className="flex gap-3 mt-3 ml-11">
                    {email.open_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        Aberto {email.open_count}x
                      </span>
                    )}
                    {email.click_count > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        Clicado {email.click_count}x
                      </span>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-3 ml-11">
                  {onReply && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onReply(email)}>
                      <Reply className="w-3.5 h-3.5" />
                      Responder
                    </Button>
                  )}
                  {onForward && (
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => onForward(email)}>
                      <Forward className="w-3.5 h-3.5" />
                      Encaminhar
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
