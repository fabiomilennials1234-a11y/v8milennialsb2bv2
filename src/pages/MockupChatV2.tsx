/**
 * MockupChatV2 — rota pública /_mockup/chat-v2 (C16)
 *
 * Renderiza o ChatShell completo com dados fake ricos para validação visual.
 * Controles no topo: toggle density, dark/light, +1 mensagem, empty state.
 * Sem autenticação, sem chamadas Supabase.
 *
 * Cenários via query ?scenario=:
 *   empty       — nenhuma conversa selecionada
 *   active      — conversa com mensagens variadas (default)
 *   context     — painel de contexto aberto
 */
import { useState, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AlignJustify, List, LayoutList, Moon, Sun, Plus, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ChatShell } from "@/components/chat/layout/ChatShell";
import { ChatHeader } from "@/components/chat/view/ChatHeader";
import { MessageList } from "@/components/chat/view/MessageList";
import { ContextPanel } from "@/components/chat/context-panel/ContextPanel";
import { useChatDensity } from "@/hooks/chat/useChatDensity";
import type { WhatsAppMessage, FailedMessage } from "@/hooks/chat/types";
import type { TransferEvent } from "@/components/chat/view/MessageList";

// ─── Dados fake ───────────────────────────────────────────────────────────────

const MOCK_PHONE = "11987654321";
const MOCK_CONTACT_NAME = "Rodrigo Ferreira";
const MOCK_MOUNT_TIME = new Date("2026-04-22T10:00:00").getTime();

const MOCK_CONTACTS = [
  { phone_number: MOCK_PHONE,     name: "Rodrigo Ferreira", last: "Perfeito, até amanhã!",   time: "14:32", unread: 0, hasLead: true },
  { phone_number: "11976543210",  name: "Carla Mendes",     last: "Pode me enviar o contrato?", time: "13:45", unread: 3, hasLead: true },
  { phone_number: "11965432109",  name: "Paulo Salave",     last: "Oi, tudo bem?",              time: "12:10", unread: 0, hasLead: false },
  { phone_number: "11954321098",  name: "Ana Oliveira",     last: "Aguardando proposta",        time: "10:52", unread: 1, hasLead: true },
  { phone_number: "11943210987",  name: "Bruno Costa",      last: "Confirmado para sexta",      time: "Ontem",  unread: 0, hasLead: true },
  { phone_number: "11932109876",  name: "Fernanda Lima",    last: "Ok, obrigada!",               time: "Ontem",  unread: 2, hasLead: false },
  { phone_number: "11921098765",  name: "Lucas Alves",      last: "Quando posso ligar?",         time: "Ter",    unread: 0, hasLead: true },
  { phone_number: "11910987654",  name: "Juliana Santos",   last: "Preciso de mais detalhes",    time: "Ter",    unread: 0, hasLead: true },
  { phone_number: "11909876543",  name: "Diego Martins",    last: "Entendi, vou pensar",         time: "Seg",    unread: 0, hasLead: false },
  { phone_number: "11898765432",  name: "Camila Rocha",     last: "Ótimo atendimento!",          time: "Seg",    unread: 1, hasLead: true },
];

function buildMessages(mountTime: number, count: number): WhatsAppMessage[] {
  const base = new Date("2026-04-22T10:00:00").getTime();
  const msgs: WhatsAppMessage[] = [
    {
      id: "1", organization_id: "org1", instance_id: "inst1", message_id: "m1",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "incoming", message_type: "text",
      content: "Oi! Tudo bem? Estava pensando no que conversamos na semana passada sobre o sistema de CRM.",
      media_url: null, push_name: MOCK_CONTACT_NAME, status: "read",
      lead_id: "lead1", timestamp: new Date(base).toISOString(), created_at: new Date(base).toISOString(), sent_by_ai: null,
    },
    {
      id: "2", organization_id: "org1", instance_id: "inst1", message_id: "m2",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "outgoing", message_type: "text",
      content: "Olá Rodrigo! Sim, estava esperando seu contato. Quer que eu agende uma demonstração esta semana?",
      media_url: null, push_name: null, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 60000).toISOString(), created_at: new Date(base + 60000).toISOString(), sent_by_ai: false,
    },
    {
      id: "3", organization_id: "org1", instance_id: "inst1", message_id: "m3",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "outgoing", message_type: "text",
      content: "Tenho horários disponíveis na terça e quinta-feira, das 10h às 18h.",
      media_url: null, push_name: null, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 62000).toISOString(), created_at: new Date(base + 62000).toISOString(), sent_by_ai: false,
    },
    {
      id: "4", organization_id: "org1", instance_id: "inst1", message_id: "m4",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "outgoing", message_type: "text",
      content: "Baseado no seu perfil, acredito que o plano Profissional seria o mais adequado para sua equipe de 15 vendedores.",
      media_url: null, push_name: null, status: "delivered",
      lead_id: "lead1", timestamp: new Date(base + 64000).toISOString(), created_at: new Date(base + 64000).toISOString(), sent_by_ai: true,
    },
    {
      id: "5", organization_id: "org1", instance_id: "inst1", message_id: "m5",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "incoming", message_type: "text",
      content: "Quinta-feira às 14h seria perfeito para mim.",
      media_url: null, push_name: MOCK_CONTACT_NAME, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 300000).toISOString(), created_at: new Date(base + 300000).toISOString(), sent_by_ai: null,
    },
    {
      id: "6", organization_id: "org1", instance_id: "inst1", message_id: "m6",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "incoming", message_type: "audio",
      content: "Mensagem de voz",
      media_url: "https://example.com/audio.mp3", push_name: MOCK_CONTACT_NAME, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 360000).toISOString(), created_at: new Date(base + 360000).toISOString(), sent_by_ai: null,
    },
    {
      id: "7", organization_id: "org1", instance_id: "inst1", message_id: "m7",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "outgoing", message_type: "image",
      content: "Aqui está nossa apresentação de produtos",
      media_url: "https://picsum.photos/400/300", push_name: null, status: "sent",
      lead_id: "lead1", timestamp: new Date(base + 600000).toISOString(), created_at: new Date(base + 600000).toISOString(), sent_by_ai: false,
    },
    {
      id: "8", organization_id: "org1", instance_id: "inst1", message_id: "m8",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "incoming", message_type: "text",
      content: "Perfeito! Vou separar as informações da nossa empresa antes da call.",
      media_url: null, push_name: MOCK_CONTACT_NAME, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 660000).toISOString(), created_at: new Date(base + 660000).toISOString(), sent_by_ai: null,
    },
    {
      id: "9", organization_id: "org1", instance_id: "inst1", message_id: "m9",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "incoming", message_type: "text",
      content: "Só uma dúvida: tem integração com o sistema ERP SAP B1?",
      media_url: null, push_name: MOCK_CONTACT_NAME, status: "read",
      lead_id: "lead1", timestamp: new Date(base + 662000).toISOString(), created_at: new Date(base + 662000).toISOString(), sent_by_ai: null,
    },
    {
      id: "10", organization_id: "org1", instance_id: "inst1", message_id: "m10",
      remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
      direction: "outgoing", message_type: "text",
      content: "Sim! Temos integração nativa com SAP B1, Totvs Protheus e Sankhya. Posso mostrar isso na demo também.",
      media_url: null, push_name: null, status: "pending",
      lead_id: "lead1", timestamp: new Date(mountTime + 1000).toISOString(), created_at: new Date(mountTime + 1000).toISOString(), sent_by_ai: false,
    },
  ];

  if (count > msgs.length) {
    for (let i = msgs.length + 1; i <= count; i++) {
      msgs.push({
        id: String(i), organization_id: "org1", instance_id: "inst1", message_id: `m${i}`,
        remote_jid: `${MOCK_PHONE}@s.whatsapp.net`, phone_number: MOCK_PHONE,
        direction: i % 2 === 0 ? "outgoing" : "incoming", message_type: "text",
        content: `Nova mensagem ${i} gerada dinamicamente`,
        media_url: null, push_name: i % 2 !== 0 ? MOCK_CONTACT_NAME : null, status: "sent",
        lead_id: "lead1", timestamp: new Date(mountTime + i * 1500).toISOString(),
        created_at: new Date(mountTime + i * 1500).toISOString(), sent_by_ai: false,
      });
    }
  }

  return msgs;
}

const MOCK_TRANSFER_EVENTS: TransferEvent[] = [
  {
    id: "t1",
    type: "transfer_event",
    reason: "Lead transferido para atendimento humano",
    timestamp: new Date("2026-04-22T10:08:00").toISOString(),
  },
];

const MOCK_FAILED_MESSAGES: FailedMessage[] = [
  {
    id: "f1",
    phoneNumber: MOCK_PHONE,
    instanceId: "inst1",
    instanceName: "instancia-principal",
    message: "Esta mensagem falhou ao ser enviada. Clique em reenviar.",
    mediaUrl: null,
    mediaType: null,
    error: "Timeout na conexão com WhatsApp",
    timestamp: new Date(Date.now() - 30000).toISOString(),
    direction: "outgoing",
    status: "failed",
    sent_by_ai: false,
  },
];

// ─── ConversationListMock ─────────────────────────────────────────────────────

function MockConversationList({
  selectedPhone,
  onSelect,
}: {
  selectedPhone: string | null;
  onSelect: (phone: string) => void;
}) {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-3 border-b border-border/60 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Inbox className="w-4 h-4 text-muted-foreground" />
            WhatsApp
          </h2>
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            {MOCK_CONTACTS.filter((c) => c.unread > 0).length} não lidas
          </Badge>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar contatos..."
            className="w-full h-8 px-3 text-xs rounded-md border border-border/60 bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {MOCK_CONTACTS.map((c) => (
          <button
            key={c.phone_number}
            type="button"
            onClick={() => onSelect(c.phone_number)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50",
              selectedPhone === c.phone_number && "bg-primary/10 border-r-2 border-primary",
            )}
            style={{ minHeight: "var(--chat-list-row-height, 72px)" }}
          >
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0 text-sm font-semibold text-primary">
              {c.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-medium truncate">{c.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{c.time}</span>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground truncate">{c.last}</span>
                {c.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center tabular-nums px-1 shrink-0">
                    {c.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── MockChatView (center panel) ─────────────────────────────────────────────

function MockChatView({
  messages,
  transferEvents,
  failedMessages,
  selectedPhone,
  onBack,
  density,
  onDensityChange,
  showEmpty,
}: {
  messages: WhatsAppMessage[];
  transferEvents: TransferEvent[];
  failedMessages: FailedMessage[];
  selectedPhone: string | null;
  onBack: () => void;
  density: "compact" | "comfortable" | "spacious";
  onDensityChange: (d: "compact" | "comfortable" | "spacious") => void;
  showEmpty: boolean;
}) {
  const mountTime = useRef(MOCK_MOUNT_TIME).current;
  // lastReadAt: simular que lemos até a msg 8 (base + 660000)
  const lastReadAt = new Date("2026-04-22T10:11:00").getTime();

  return (
    <div className="flex flex-col h-full">
      <ChatHeader
        phoneNumber={selectedPhone ?? MOCK_PHONE}
        contactName={MOCK_CONTACT_NAME}
        hasLead={true}
        leadId="lead1"
        aiDisabled={false}
        isWaitingHuman={false}
        szChatSession={null}
        organizationId="org1"
        onBack={onBack}
        onOpenLeadModal={() => {}}
        onToggleAi={() => {}}
        onTransferToSzChatTeam={() => {}}
        toggleAiPending={false}
        transferPending={false}
        density={density}
        onDensityChange={onDensityChange}
      />
      <MessageList
        messages={showEmpty ? [] : messages}
        transferEvents={showEmpty ? [] : transferEvents}
        failedMessages={showEmpty ? [] : failedMessages}
        isLoading={false}
        contactName={MOCK_CONTACT_NAME}
        instanceName="instancia-principal"
        lastReadAt={lastReadAt}
        mountTime={mountTime}
        onImagePreview={() => {}}
        onRetry={() => {}}
        onOpenTemplates={() => {}}
      />
      {/* Composer stub */}
      <div className="p-3 border-t border-border/60 bg-background shrink-0">
        <div className="flex items-center gap-2">
          <div
            className="flex-1 h-9 rounded-full border border-border/60 bg-muted/20 px-4 flex items-center"
            style={{ minHeight: "var(--chat-composer-min-h, 44px)" }}
          >
            <span className="text-sm text-muted-foreground/40">Mensagem para {MOCK_CONTACT_NAME}...</span>
          </div>
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-xs text-primary font-semibold">→</span>
          </div>
        </div>
        <p className="hidden sm:block mt-1.5 text-[10px] text-muted-foreground/40 select-none">
          <kbd className="font-sans">⏎</kbd> enviar · <kbd className="font-sans">⇧⏎</kbd> nova linha · <kbd className="font-sans">⌘K</kbd> templates
        </p>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function MockupChatV2() {
  const [searchParams] = useSearchParams();
  const scenario = searchParams.get("scenario") ?? "active";

  const [selectedPhone, setSelectedPhone] = useState<string | null>(
    scenario === "empty" ? null : MOCK_PHONE
  );
  const [showEmpty, setShowEmpty] = useState(false);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [messageCount, setMessageCount] = useState(10);

  // Density sem userId — fallback in-memory "comfortable"
  const { density, setDensity, cssVars } = useChatDensity(undefined);

  const messages = useMemo(
    () => buildMessages(MOCK_MOUNT_TIME, messageCount),
    [messageCount]
  );

  const toggleDark = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const addMessage = useCallback(() => {
    setMessageCount((n) => n + 1);
  }, []);

  const showContext = scenario === "context" || selectedPhone !== null;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Demo Controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border/60 bg-muted/30 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground mr-2">MockupChatV2</span>

        {/* Density */}
        <div className="flex items-center gap-1" role="group" aria-label="Densidade">
          {(["compact", "comfortable", "spacious"] as const).map((d) => (
            <Button
              key={d}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-xs",
                density === d && "ring-2 ring-ring bg-muted",
              )}
              onClick={() => setDensity(d)}
            >
              {d === "compact" ? <AlignJustify className="w-3 h-3 mr-1" /> : d === "comfortable" ? <List className="w-3 h-3 mr-1" /> : <LayoutList className="w-3 h-3 mr-1" />}
              {d}
            </Button>
          ))}
        </div>

        <div className="w-px h-5 bg-border/60" />

        {/* Dark toggle */}
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleDark}>
          {isDark ? <Sun className="w-3 h-3 mr-1" /> : <Moon className="w-3 h-3 mr-1" />}
          {isDark ? "Light" : "Dark"}
        </Button>

        <div className="w-px h-5 bg-border/60" />

        {/* Add message */}
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addMessage}>
          <Plus className="w-3 h-3 mr-1" />
          +1 msg
        </Button>

        {/* Toggle empty */}
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 text-xs", showEmpty && "bg-muted")}
          onClick={() => setShowEmpty((v) => !v)}
        >
          {showEmpty ? "Ver mensagens" : "Empty state"}
        </Button>

        {/* Scenario selector */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">cenário:</span>
          {["empty", "active", "context"].map((s) => (
            <a
              key={s}
              href={`?scenario=${s}`}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded border transition-colors",
                scenario === s
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:border-muted-foreground",
              )}
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      {/* ── ChatShell ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 p-3">
        <ChatShell
          list={
            <MockConversationList
              selectedPhone={selectedPhone}
              onSelect={setSelectedPhone}
            />
          }
          view={
            selectedPhone ? (
              <MockChatView
                messages={messages}
                transferEvents={MOCK_TRANSFER_EVENTS}
                failedMessages={MOCK_FAILED_MESSAGES}
                selectedPhone={selectedPhone}
                onBack={() => setSelectedPhone(null)}
                density={density}
                onDensityChange={setDensity}
                showEmpty={showEmpty}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-4">
                <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center">
                  <Inbox className="w-8 h-8 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Nenhuma conversa selecionada</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Escolha uma conversa na lista ao lado</p>
                </div>
              </div>
            )
          }
          context={
            showContext ? (
              <ContextPanel
                leadId="lead1"
                phoneNumber={selectedPhone ?? MOCK_PHONE}
                pushName={MOCK_CONTACT_NAME}
                defaultTab="info"
              />
            ) : undefined
          }
          selectedPhone={selectedPhone}
          onBack={() => setSelectedPhone(null)}
          density={density}
          densityCssVars={cssVars}
        />
      </div>
    </div>
  );
}
