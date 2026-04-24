import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, CheckCheck, Clock, AlertCircle, RotateCw, Bot } from "lucide-react";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ScrollToBottomFab } from "@/components/chat/ScrollToBottomFab";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { useConversationDraft } from "@/hooks/useConversationDraft";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Direction = "incoming" | "outgoing";
type Status = "pending" | "sent" | "delivered" | "read" | "failed";

interface MockMessage {
  id: string;
  direction: Direction;
  status: Status;
  text: string;
  timestamp: string;
  sent_by_ai?: boolean;
  error?: string;
}

const now = Date.now();
const t = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

const messages: MockMessage[] = [
  { id: "1", direction: "incoming", status: "read", text: "Oi! Vi o anúncio de vocês. Ainda tem vaga?", timestamp: t(45) },
  { id: "2", direction: "outgoing", status: "read", text: "Olá Rafael! Tem sim. Posso te enviar mais detalhes?", timestamp: t(44), sent_by_ai: true },
  { id: "3", direction: "outgoing", status: "read", text: "Vou precisar de algumas informações antes.", timestamp: t(44), sent_by_ai: true },
  { id: "4", direction: "outgoing", status: "read", text: "Qual o faturamento mensal da sua empresa?", timestamp: t(43), sent_by_ai: true },
  { id: "5", direction: "incoming", status: "read", text: "Uns 80k/mês", timestamp: t(20) },
  { id: "6", direction: "incoming", status: "read", text: "Mas tá crescendo rápido", timestamp: t(20) },
  { id: "7", direction: "outgoing", status: "read", text: "Perfeito. Vou te chamar numa call de 20min pra te mostrar como funciona na prática.", timestamp: t(18), sent_by_ai: true },
  { id: "8", direction: "incoming", status: "delivered", text: "Bora", timestamp: t(3) },
  { id: "9", direction: "incoming", status: "delivered", text: "Amanhã às 14h tá bom?", timestamp: t(3) },
  { id: "10", direction: "outgoing", status: "failed", text: "Agendei aqui! Te mando o link do Meet daqui a pouco.", timestamp: t(1), error: "Falha de conexão com Evolution API" },
];

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case "pending":
      return <Clock className="w-3 h-3 text-muted-foreground/50" />;
    case "sent":
      return <Check className="w-3 h-3 text-muted-foreground/50" />;
    case "delivered":
      return <CheckCheck className="w-3 h-3 text-muted-foreground/50" />;
    case "read":
      return <CheckCheck className="w-3 h-3 text-blue-500/70" />;
    case "failed":
      return <AlertCircle className="w-3 h-3 text-destructive" />;
    default:
      return null;
  }
}

function MessageBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
  onRetry,
}: {
  message: MockMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onRetry?: (m: MockMessage) => void;
}) {
  const isOutgoing = message.direction === "outgoing";
  const isFailed = message.status === "failed";

  const radiusClass = isOutgoing
    ? isFirstInGroup && isLastInGroup
      ? "rounded-2xl rounded-br-sm"
      : isFirstInGroup
      ? "rounded-t-2xl rounded-bl-2xl rounded-br-md rounded-tr-2xl"
      : isLastInGroup
      ? "rounded-b-2xl rounded-bl-2xl rounded-br-sm rounded-tr-md"
      : "rounded-l-2xl rounded-r-md"
    : isFirstInGroup && isLastInGroup
    ? "rounded-2xl rounded-bl-sm"
    : isFirstInGroup
    ? "rounded-t-2xl rounded-br-2xl rounded-bl-md"
    : isLastInGroup
    ? "rounded-b-2xl rounded-br-2xl rounded-bl-sm"
    : "rounded-r-2xl rounded-l-md";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex", isOutgoing ? "justify-end" : "justify-start", isFirstInGroup ? "mt-3" : "mt-0.5")}
    >
      <div
        className={cn(
          "max-w-[75%] px-4 py-2.5",
          radiusClass,
          isOutgoing ? "bg-muted/80 border border-border/60" : "bg-card border border-border/40",
          isFailed && "border-destructive/40"
        )}
      >
        {isFirstInGroup && message.sent_by_ai && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium text-primary/80">
            <Bot className="w-3 h-3" />
            Copilot Qualificador
          </div>
        )}
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{message.text}</p>
        {isFailed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="text-[11px] text-destructive hover:text-destructive/80 mt-1.5 font-medium flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded focus-visible:outline-none"
            title={message.error}
          >
            <RotateCw className="w-3 h-3" /> Tentar novamente
          </button>
        )}
        {isLastInGroup && (
          <div className="flex items-center justify-end gap-1 mt-1">
            <time
              dateTime={message.timestamp}
              className="text-[10px] text-muted-foreground/50 tabular-nums"
            >
              {new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </time>
            {isOutgoing && <StatusIcon status={message.status} />}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function computeGrouping(index: number, list: MockMessage[]) {
  const curr = list[index];
  const prev = index > 0 ? list[index - 1] : null;
  const next = index < list.length - 1 ? list[index + 1] : null;
  const sameAuthorPrev = prev && prev.direction === curr.direction && !!prev.sent_by_ai === !!curr.sent_by_ai;
  const sameAuthorNext = next && next.direction === curr.direction && !!next.sent_by_ai === !!curr.sent_by_ai;
  const deltaPrev = prev ? Math.abs(new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) : Infinity;
  const deltaNext = next ? Math.abs(new Date(next.timestamp).getTime() - new Date(curr.timestamp).getTime()) : Infinity;
  return {
    isFirstInGroup: !(sameAuthorPrev && deltaPrev < 120_000),
    isLastInGroup: !(sameAuthorNext && deltaNext < 120_000),
  };
}

export default function MockupChat() {
  const [localMessages, setLocalMessages] = useState(messages);
  const [selectedContact, setSelectedContact] = useState<string>("rafael");
  const { draft, setDraft } = useConversationDraft(`demo:${selectedContact}`);
  const [fabVisible, setFabVisible] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [showEmpty, setShowEmpty] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const firstUnreadIndex = localMessages.findIndex((m) => m.direction === "incoming" && m.status === "delivered");
  const unreadCount = localMessages.filter((m, i) => i >= firstUnreadIndex && m.direction === "incoming" && m.status === "delivered").length;

  const handleRetry = (m: MockMessage) => {
    setLocalMessages((prev) => prev.map((msg) => (msg.id === m.id ? { ...msg, status: "sent" as Status } : msg)));
  };

  const contacts = [
    { id: "rafael", name: "Rafael Souza", company: "Distribuidora Souza", last: "Amanhã às 14h tá bom?", unread: 2, time: "14:32" },
    { id: "ana", name: "Ana Paula", company: "Clínica Vitale", last: "Vou avaliar e te retorno", unread: 0, time: "13:18" },
    { id: "carlos", name: "Carlos Mendes", company: "Fábrica Mendes", last: "Perfeito, pode mandar a proposta", unread: 0, time: "12:40" },
    { id: "lucia", name: "Lúcia Ferreira", company: "Escola Luz", last: "[áudio] 0:14", unread: 5, time: "11:05" },
    { id: "novo", name: "João Ribeiro", company: "Indústria JR", last: "", unread: 0, time: "" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="px-2 py-1 text-xs font-mono rounded bg-primary/10 text-primary border border-primary/20">MOCKUP</span>
            <h1 className="text-2xl font-bold">Chat — Onda 1 Redesign</h1>
          </div>
          <p className="text-sm text-muted-foreground">12 commits em <code className="text-xs bg-muted px-1.5 py-0.5 rounded">feat/chat-ux-ui-redesign</code>. Dados fake — componentes reais renderizados.</p>
        </div>

        <div className="grid grid-cols-12 gap-4 h-[520px] border border-border rounded-2xl overflow-hidden bg-card">
          <aside className="col-span-4 border-r border-border bg-background/50 flex flex-col">
            <div className="p-4 border-b border-border">
              <Input placeholder="Buscar conversa..." className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {contacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setSelectedContact(c.id); setShowEmpty(c.id === "novo"); }}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b border-border/50 transition-colors",
                    "hover:bg-muted/40",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:outline-none focus-visible:z-10 relative",
                    selectedContact === c.id && "bg-muted/60"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-sm font-semibold shrink-0">
                      {c.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{c.name}</span>
                        <time className="text-[10px] text-muted-foreground tabular-nums shrink-0">{c.time}</time>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">{c.last || "Nova conversa"}</span>
                        {c.unread > 0 && (
                          <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 tabular-nums shrink-0">
                            {c.unread}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{c.company}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="col-span-8 flex flex-col relative">
            <header className="px-6 py-3.5 border-b border-border flex items-center justify-between bg-background/50">
              <div>
                <h2 className="text-sm font-semibold">{showEmpty ? "João Ribeiro" : "Rafael Souza"}</h2>
                <p className="text-xs text-muted-foreground">{showEmpty ? "Indústria JR" : "Distribuidora Souza · online"}</p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                <Bot className="w-3 h-3" /> IA ativa
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
              {showEmpty ? (
                <ChatEmptyState contactName="João Ribeiro" instanceName="Comercial" onOpenTemplates={() => alert("Abriria /slash popover")} />
              ) : (
                <>
                  {localMessages.map((msg, i) => {
                    const { isFirstInGroup, isLastInGroup } = computeGrouping(i, localMessages);
                    return (
                      <div key={msg.id}>
                        {i === firstUnreadIndex && unreadCount > 0 && <UnreadDivider count={unreadCount} />}
                        <MessageBubble message={msg} isFirstInGroup={isFirstInGroup} isLastInGroup={isLastInGroup} onRetry={handleRetry} />
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <ScrollToBottomFab
              visible={fabVisible}
              count={newCount}
              onClick={() => { setFabVisible(false); setNewCount(0); }}
            />

            <footer className="p-4 border-t border-border bg-background/50">
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Digite uma mensagem ou / para templates..."
                  className="flex-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                />
                <Button>Enviar</Button>
              </div>
              {draft.length > 0 && (
                <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                  Rascunho salvo automaticamente · <code className="text-[10px] bg-muted px-1 rounded">chat-draft-demo:{selectedContact}</code>
                </p>
              )}
            </footer>
          </section>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="p-5 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-semibold mb-3">Simular FAB</h3>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => { setFabVisible(true); setNewCount(newCount + 1); }}>
                +1 nova mensagem
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setFabVisible(false); setNewCount(0); }}>
                Reset
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">FAB flutuante aparece no canto inferior direito do chat acima.</p>
          </div>
          <div className="p-5 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-semibold mb-3">Empty state</h3>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowEmpty(!showEmpty)}>
                Toggle empty state
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Clica em "João Ribeiro" na lista ou use toggle. Renderiza `ChatEmptyState` sem mensagens.</p>
          </div>
          <div className="p-5 rounded-xl border border-border bg-card">
            <h3 className="text-sm font-semibold mb-3">Items da Onda 1</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>✓ Tabular-nums + &lt;time&gt;</li>
              <li>✓ Focus ring composer/lista</li>
              <li>✓ Drafts por conversa</li>
              <li>✓ Empty state CTA</li>
              <li>✓ Grouping &lt;2min</li>
              <li>✓ Motion só nova</li>
              <li>✓ Tokens muted/card</li>
              <li>✓ Unread divider</li>
              <li>✓ Smart scroll FAB</li>
              <li>✓ Retry msg falha</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
