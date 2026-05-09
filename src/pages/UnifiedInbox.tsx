import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Inbox,
  MessageSquare,
  Mail,
  Smartphone,
  Search,
  Loader2,
  ArrowRight,
  Clock,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useUnifiedConversations,
  type InboxChannel,
} from "@/hooks/useUnifiedInbox";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const CHANNEL_CONFIG: Record<
  InboxChannel,
  { label: string; icon: React.ElementType; color: string; bg: string }
> = {
  whatsapp: { label: "WhatsApp", icon: MessageSquare, color: "text-green-500", bg: "bg-green-500/10" },
  email: { label: "Email", icon: Mail, color: "text-blue-500", bg: "bg-blue-500/10" },
  sms: { label: "SMS", icon: Smartphone, color: "text-amber-500", bg: "bg-amber-500/10" },
  instagram: { label: "Instagram", icon: MessageSquare, color: "text-pink-500", bg: "bg-pink-500/10" },
  messenger: { label: "Messenger", icon: MessageSquare, color: "text-indigo-500", bg: "bg-indigo-500/10" },
};

const CHANNEL_FILTERS: { value: InboxChannel | null; label: string }[] = [
  { value: null, label: "Todos" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];

export default function UnifiedInbox() {
  const [channelFilter, setChannelFilter] = useState<InboxChannel | null>(null);
  const [search, setSearch] = useState("");

  const { data: conversations = [], isLoading } = useUnifiedConversations(channelFilter, 100);

  const filtered = search
    ? conversations.filter(
        (c) =>
          c.lead_name?.toLowerCase().includes(search.toLowerCase()) ||
          c.last_message?.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Inbox className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Caixa de Entrada</h1>
              <p className="text-sm text-muted-foreground">
                Todas as conversas em um lugar
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            {filtered.length} conversa{filtered.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {CHANNEL_FILTERS.map((f) => (
              <button
                key={f.value ?? "all"}
                onClick={() => setChannelFilter(f.value)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full border transition-colors",
                  channelFilter === f.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar conversa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Inbox className="w-12 h-12 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {search
                ? "Nenhuma conversa encontrada."
                : "Nenhuma conversa ainda."}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((conv) => {
              const ch = CHANNEL_CONFIG[conv.channel] ?? CHANNEL_CONFIG.whatsapp;
              const Icon = ch.icon;
              const chatPath =
                conv.channel === "whatsapp" && conv.lead_phone
                  ? `/chat-whatsapp?phone=${encodeURIComponent(conv.lead_phone)}`
                  : `/chat-whatsapp`;

              return (
                <Link
                  key={`${conv.lead_id}-${conv.channel}`}
                  to={chatPath}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/80 transition-colors group border border-transparent hover:border-border"
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <User className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-background",
                        ch.bg
                      )}
                    >
                      <Icon className={cn("w-2.5 h-2.5", ch.color)} />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">
                        {conv.lead_name || "Desconhecido"}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatDistanceToNow(new Date(conv.last_sent_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] px-1 py-0 h-3.5 shrink-0", ch.bg)}
                      >
                        <span className={ch.color}>{ch.label}</span>
                      </Badge>
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.last_direction === "outbound" ? "Voce: " : ""}
                        {conv.last_message || "—"}
                      </p>
                    </div>
                  </div>

                  {/* Unread + arrow */}
                  <div className="flex items-center gap-2 shrink-0">
                    {conv.unread_count > 0 && (
                      <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                        {conv.unread_count > 9 ? "9+" : conv.unread_count}
                      </div>
                    )}
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
