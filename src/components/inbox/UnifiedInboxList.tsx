import { useState } from "react";
import { MessageSquare, Mail, Phone, Loader2, Inbox, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useUnifiedConversations, type InboxChannel, type UnifiedConversation } from "@/hooks/useUnifiedInbox";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const CHANNEL_TABS: Array<{ value: InboxChannel | null; label: string; icon: React.ElementType }> = [
  { value: null, label: "Todos", icon: Inbox },
  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "SMS", icon: Phone },
];

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "bg-[#25D366]/10 text-[#25D366]",
  email: "bg-blue-500/10 text-blue-500",
  sms: "bg-purple-500/10 text-purple-500",
  instagram: "bg-pink-500/10 text-pink-500",
  messenger: "bg-blue-600/10 text-blue-600",
};

interface UnifiedInboxListProps {
  onSelectConversation?: (conversation: UnifiedConversation) => void;
  selectedLeadId?: string | null;
}

export function UnifiedInboxList({ onSelectConversation, selectedLeadId }: UnifiedInboxListProps) {
  const [activeChannel, setActiveChannel] = useState<InboxChannel | null>(null);
  const [search, setSearch] = useState("");
  const { data: conversations, isLoading } = useUnifiedConversations(activeChannel);

  const filtered = conversations?.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.lead_name?.toLowerCase().includes(q) ||
      c.lead_phone?.includes(q) ||
      c.lead_email?.toLowerCase().includes(q) ||
      c.last_message?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full">
      {/* Channel tabs */}
      <div className="flex gap-1 px-3 pt-3 pb-2">
        {CHANNEL_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.label}
              onClick={() => setActiveChannel(tab.value)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                activeChannel === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar conversa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered && filtered.length > 0 ? (
          <div className="space-y-0.5 px-1.5">
            {filtered.map((conv) => (
              <button
                key={`${conv.lead_id}-${conv.channel}`}
                onClick={() => onSelectConversation?.(conv)}
                className={cn(
                  "w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                  selectedLeadId === conv.lead_id
                    ? "bg-primary/10"
                    : "hover:bg-muted/50"
                )}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-muted-foreground">
                    {conv.lead_name?.[0]?.toUpperCase() || "?"}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{conv.lead_name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(conv.last_sent_at), { addSuffix: false, locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge
                      variant="outline"
                      className={cn("text-[9px] px-1 py-0 h-3.5 border-0", CHANNEL_COLORS[conv.channel])}
                    >
                      {conv.channel}
                    </Badge>
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.last_direction === "outbound" && "Você: "}
                      {conv.last_message || "..."}
                    </p>
                  </div>
                </div>

                {conv.unread_count > 0 && (
                  <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                    <span className="text-[10px] font-bold text-primary-foreground">{conv.unread_count}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Inbox className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {search ? "Nenhuma conversa encontrada." : "Sua inbox está vazia."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
