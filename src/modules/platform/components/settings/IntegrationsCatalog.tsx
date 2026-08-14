import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Plug,
  Search,
  ChevronRight,
  Phone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// Componentes de configuração existentes (reaproveitados integralmente)
import { FacebookSettings, InstagramSettings } from "./MetaSettings";
import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import { TinyErpSettings } from "./TinyErpSettings";
import { OmieSettings } from "./OmieSettings";
import { ElevenLabsSettings } from "./ElevenLabsSettings";
import { WhatsAppSettings } from "./WhatsAppSettings";
import { TorqueCallsSettings } from "./TorqueCallsSettings";
import { InstagramChannelSettings } from "./InstagramChannelSettings";

// Hooks de status
import { useMetaConnectionStatusByType } from "@/modules/communication/hooks/useMetaConnection";
import { useGoogleCalendarStatus } from "@/modules/integrations/hooks/useGoogleCalendar";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { useOmieStatus } from "@/modules/integrations";
import { useWhatsAppInstances, useVoipSessions } from "@/modules/communication";
// Import direto do módulo do hook, e não do barrel, pelo MESMO motivo do
// `useMetaConnection` logo acima: a suíte deste arquivo mocka
// `@/modules/communication` de forma exaustiva, e um export a mais no barrel
// deixaria o CI vermelho por um símbolo que o mock não conhece — não por
// defeito. Aqui não entra hook nenhum: só a função de leitura e a chave.
import {
  fetchMessagingChannels,
  messagingChannelsQueryKey,
} from "@/modules/communication/hooks/useMessagingChannels";
import { useOrganization } from "@/modules/identity";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { useFeatureFlag } from "@/modules/platform/hooks/useFeatureFlag";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";

// ─── Brand Logos (SVG inline para visual premium) ───────

function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#25D366" />
      <path
        d="M34.6 13.4C32.1 10.9 28.7 9.5 25.1 9.5c-7.5 0-13.6 6.1-13.6 13.6 0 2.4.6 4.7 1.8 6.8L11.4 37l7.3-1.9c2 1.1 4.2 1.6 6.4 1.6 7.5 0 13.6-6.1 13.6-13.6 0-3.6-1.4-7.1-4.1-9.7zM25.1 34.3c-2 0-4-.5-5.7-1.6l-.4-.2-4.2 1.1 1.1-4.1-.3-.4c-1.1-1.8-1.7-3.9-1.7-6 0-6.2 5.1-11.3 11.3-11.3 3 0 5.8 1.2 8 3.3 2.1 2.1 3.3 5 3.3 8-.1 6.3-5.2 11.2-11.4 11.2zm6.2-8.4c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.7.2s-.8 1.1-1 1.3c-.2.2-.3.2-.6.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-2-1.8-2.3-.2-.3 0-.5.1-.7.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.3-.6-.4z"
        fill="white"
      />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#1877F2" />
      <path
        d="M29.5 25.5l.7-4.5h-4.3V18c0-1.2.6-2.4 2.5-2.4h2V11.8s-1.8-.3-3.5-.3c-3.6 0-5.9 2.2-5.9 6.1V21h-4v4.5h4V38h4.9V25.5h3.6z"
        fill="white"
      />
    </svg>
  );
}

function InstagramLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFDC80" />
          <stop offset="25%" stopColor="#F77737" />
          <stop offset="50%" stopColor="#E1306C" />
          <stop offset="75%" stopColor="#C13584" />
          <stop offset="100%" stopColor="#833AB4" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#ig-grad)" />
      <rect x="14" y="14" width="20" height="20" rx="6" stroke="white" strokeWidth="2.5" fill="none" />
      <circle cx="24" cy="24" r="5" stroke="white" strokeWidth="2.5" fill="none" />
      <circle cx="30.5" cy="17.5" r="1.8" fill="white" />
    </svg>
  );
}

function GoogleCalendarLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#4285F4" />
      <rect x="13" y="11" width="22" height="26" rx="3" fill="white" />
      <rect x="13" y="11" width="22" height="8" rx="3" fill="#EA4335" />
      <rect x="17" y="22" width="4" height="4" rx="0.5" fill="#4285F4" />
      <rect x="22" y="22" width="4" height="4" rx="0.5" fill="#4285F4" />
      <rect x="27" y="22" width="4" height="4" rx="0.5" fill="#4285F4" />
      <rect x="17" y="28" width="4" height="4" rx="0.5" fill="#4285F4" />
      <rect x="22" y="28" width="4" height="4" rx="0.5" fill="#4285F4" />
      <line x1="19" y1="9" x2="19" y2="14" stroke="#616161" strokeWidth="2" strokeLinecap="round" />
      <line x1="29" y1="9" x2="29" y2="14" stroke="#616161" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TinyErpLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#7C3AED" />
      <path d="M15 16h18v3H15zM15 22h12v3H15zM15 28h15v3H15z" fill="white" opacity="0.9" />
      <circle cx="33" cy="31" r="4" fill="#A78BFA" />
      <path d="M31.5 31l1.2 1.2 2.3-2.3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OmieLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#00A868" />
      <circle cx="24" cy="24" r="10" stroke="white" strokeWidth="3" fill="none" />
      <circle cx="24" cy="24" r="3.5" fill="white" />
    </svg>
  );
}

function ElevenLabsLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full">
      <rect width="48" height="48" rx="12" fill="#0F0F0F" />
      <rect x="18" y="13" width="4" height="22" rx="2" fill="white" />
      <rect x="26" y="13" width="4" height="22" rx="2" fill="white" />
    </svg>
  );
}

// TorqueCalls é produto próprio (não uma marca externa) — por isso, ao
// contrário dos logos acima, usa o token `primary` do tema em vez de um hex
// de marca. Cor literal aqui seria bug (CLAUDE.md), e uma marca de terceiro
// não existe para copiar.
function TorqueCallsLogo() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-xl bg-primary">
      <Phone className="h-6 w-6 text-primary-foreground" />
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────

type IntegrationCategory = "messaging" | "crm" | "calendar" | "ai" | "marketing";

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  category: IntegrationCategory;
  logo: ReactNode;
  features: string[];
  /** ID do componente de settings a renderizar no modal */
  settingsId: string;
  /** Quando presente, o cartão só aparece se a organização tiver a feature. */
  featureKey?: FeatureKey;
  /**
   * Quando presente, o cartão só aparece se a flag jsonb homônima estiver
   * ligada em `organizations.feature_flags`.
   *
   * DIFERENTE de `featureKey`, e de propósito: `featureKey` é PLANO (o que a org
   * paga, tipado no catálogo de features), esta é ROLLOUT (o que já está pronto
   * para esta org, ligado por UPDATE direto). Um canal em rollout não vira item
   * de plano até existir de verdade — e enquanto não vira, não aparece no
   * BillingOverrideModal. Aceito conscientemente.
   */
  flagKey?: string;
}

const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  messaging: "Mensagens",
  marketing: "Marketing & Redes Sociais",
  calendar: "Calendário",
  crm: "CRM & ERP",
  ai: "Inteligência Artificial",
};

const CATEGORY_ORDER: IntegrationCategory[] = ["messaging", "marketing", "calendar", "crm", "ai"];

// ─── Integration Definitions ────────────────────────────

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Conecte números para envio e recebimento de mensagens automatizadas.",
    longDescription: "Conecte números de WhatsApp via QR Code para habilitar envio de mensagens automáticas pelo Copilot, disparos em campanhas e atendimento integrado ao chat do Torque.",
    category: "messaging",
    logo: <WhatsAppLogo />,
    features: ["Múltiplas instâncias", "QR Code", "Disparos automatizados", "Chat integrado"],
    settingsId: "whatsapp",
  },
  {
    id: "torquecalls",
    name: "TorqueCalls",
    description: "Ligue por WhatsApp direto do CRM, sem sair da conversa.",
    longDescription: "Ative chamada de voz num número de WhatsApp que você já conectou. O vendedor liga pelo chat do lead, e a ligação sai pelo próprio WhatsApp da empresa.",
    category: "messaging",
    logo: <TorqueCallsLogo />,
    features: ["Chamada pelo chat", "Usa o número que já existe", "Histórico no lead"],
    settingsId: "torquecalls",
    featureKey: "voice_calls",
  },
  {
    // Instagram como CANAL DE ATENDIMENTO, pelo NotificaMe — prateleira
    // diferente do card "Instagram" de marketing, que é o caminho antigo pela
    // Graph API e continua existindo por mais uma fatia (é ele que tem caixa de
    // entrada hoje). Dois caminhos, dois rótulos, nunca "Instagram" duas vezes
    // com o mesmo nome na mesma prateleira.
    id: "instagram_oficial",
    name: "Instagram (oficial)",
    description: "Conecte a conta profissional com verificação da Meta.",
    longDescription:
      "Conecte a conta profissional do Instagram pelo login da Meta, sem depender de um app próprio. Esta etapa entrega a conexão da conta; o recebimento de mensagens diretas no Torque entra em seguida.",
    category: "messaging",
    logo: <InstagramLogo />,
    features: ["Conta profissional", "Login pela Meta", "Direct — em breve"],
    settingsId: "instagram_oficial",
    flagKey: "notificame_instagram",
  },
  {
    id: "facebook",
    name: "Facebook",
    description: "Capture leads de anúncios e converse pelo Messenger.",
    longDescription: "Conecte suas páginas do Facebook para capturar leads automaticamente via Meta Lead Ads, receber mensagens do Messenger e gerenciar conversas diretamente no Torque.",
    category: "marketing",
    logo: <FacebookLogo />,
    features: ["Lead Ads automático", "Messenger", "Múltiplas páginas", "Formulários"],
    settingsId: "facebook",
  },
  {
    id: "instagram",
    name: "Instagram",
    description: "Receba mensagens do Instagram Direct e conecte seu perfil comercial.",
    longDescription: "Conecte sua conta do Instagram para receber e responder mensagens do Instagram Direct diretamente pelo Torque, mantendo o atendimento centralizado.",
    category: "marketing",
    logo: <InstagramLogo />,
    features: ["Instagram Direct", "Perfil comercial", "Mensagens centralizadas"],
    settingsId: "instagram",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Sincronize reuniões e gere links do Google Meet automaticamente.",
    longDescription: "Conecte sua conta Google para criar eventos automaticamente ao agendar reuniões no Torque, com geração automática de links do Google Meet e sincronização bidirecional.",
    category: "calendar",
    logo: <GoogleCalendarLogo />,
    features: ["Criação automática de eventos", "Links do Google Meet", "Sincronização bidirecional"],
    settingsId: "google_calendar",
  },
  {
    id: "tinyerp",
    name: "TinyERP",
    description: "Sincronize produtos e pedidos com seu sistema de gestão.",
    longDescription: "Conecte o TinyERP para sincronizar seu catálogo de produtos, gerar pedidos automaticamente ao fechar vendas e manter o estoque atualizado entre os dois sistemas.",
    category: "crm",
    logo: <TinyErpLogo />,
    features: ["Sync de produtos", "Pedidos automáticos", "Catálogo unificado"],
    settingsId: "tinyerp",
  },
  {
    id: "omie",
    name: "Omie",
    description: "Traga faturamento e contas a receber do ERP para a Carteira.",
    longDescription: "Conecte a Omie para casar clientes e pedidos por CNPJ, acompanhar faturamento (NF-e) e contas a receber, e enxergar inadimplência e receita em risco direto na Carteira. O ERP é a fonte da verdade do dinheiro; o CRM, da relação.",
    category: "crm",
    logo: <OmieLogo />,
    features: ["Clientes", "Pedidos", "Faturamento — em breve", "Contas a receber — em breve"],
    settingsId: "omie",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Habilite voz com IA para o Copilot enviar áudios naturais.",
    longDescription: "Configure a API da ElevenLabs para que o Copilot possa gerar e enviar mensagens de áudio com voz natural via WhatsApp, melhorando a experiência de atendimento automatizado.",
    category: "ai",
    logo: <ElevenLabsLogo />,
    features: ["Áudios com IA", "Vozes naturais", "Integração com Copilot"],
    settingsId: "elevenlabs",
  },
];

// ─── Status Hook ────────────────────────────────────────

function useIntegrationStatuses() {
  const { isConnected: fbConnected } = useMetaConnectionStatusByType("facebook");
  const { isConnected: igConnected } = useMetaConnectionStatusByType("instagram");
  const { data: calendarStatus } = useGoogleCalendarStatus();
  const { data: tinyStatus } = useTinyErpStatus();
  const { data: omieStatus } = useOmieStatus();
  const { data: whatsappInstances = [] } = useWhatsAppInstances();
  const { data: voipSessions = [] } = useVoipSessions();
  const { organizationId } = useOrganization();

  // Estado REAL do canal novo. Antes era `connected: false` chumbado: o cartão
  // de uma org COM Instagram conectado dizia "não conectado" e não entrava na
  // contagem — um número errado no lugar mais visível da tela.
  //
  // A queryKey é a MESMA de `useMessagingChannels`, de propósito: o
  // `invalidateQueries` que roda no fim da conexão atualiza este selo sem
  // precisar saber que ele existe. Duas chaves diferentes deixariam o badge
  // parado até o próximo F5.
  //
  // `enabled` pela flag pelo mesmo motivo do card: a tabela só existe depois da
  // migration desta fatia, e a flag desligada é exatamente o período em que ela
  // pode não existir no ambiente.
  const notificameInstagramFlag = useFeatureFlag("notificame_instagram");
  const { data: messagingChannels = [] } = useQuery({
    queryKey: messagingChannelsQueryKey(organizationId),
    enabled: notificameInstagramFlag.enabled && !!organizationId,
    queryFn: () => fetchMessagingChannels(organizationId as string),
  });

  const { data: orgData } = useQuery({
    queryKey: ["org-elevenlabs-key", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data } = await supabase
        .from("organizations")
        .select("elevenlabs_api_key")
        .eq("id", organizationId)
        .single();
      return data;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const connectedInstances = whatsappInstances.filter(
    (i: any) => i.status === "connected" || i.status === "open"
  );
  // `open`, e não `!== "closed"`. Este badge é EXIBIÇÃO, e exibição segue o
  // que o resto do sistema exige para deixar ligar: `fn_voip_call_reserve` e
  // `call-plane.ts` recusam qualquer sessão que não esteja `open`, com
  // `session_not_open`.
  //
  // O predicado `!== "closed"` continua certo — mas para o TETO, em
  // `TorqueCallsSettings`, onde a pergunta é outra: sessão `pending` já ocupa
  // websocket e memória na VPS. Os dois predicados divergem de propósito; ver
  // o comentário longo lá.
  const activeVoiceSessions = voipSessions.filter((s) => s.status === "open");

  // `status === "connected"` e não "existe uma linha": um perfil que caiu
  // continua na tabela como `disconnected`, e chamar isso de conectado é a mesma
  // mentira que o badge do TorqueCalls contava com sessão `pending`.
  const connectedInstagram = messagingChannels.filter(
    (c) => c.channel_type === "instagram" && c.status === "connected",
  );

  return {
    whatsapp: {
      connected: connectedInstances.length > 0,
      detail: connectedInstances.length > 0
        ? `${connectedInstances.length} instância(s)`
        : undefined,
    },
    torquecalls: {
      connected: activeVoiceSessions.length > 0,
      detail: activeVoiceSessions.length > 0
        ? `${activeVoiceSessions.length} número(s) com voz`
        : undefined,
    },
    facebook: {
      connected: !!fbConnected,
      detail: fbConnected ? "Páginas conectadas" : undefined,
    },
    instagram: {
      connected: !!igConnected,
      detail: igConnected ? "Perfil conectado" : undefined,
    },
    instagram_oficial: {
      connected: connectedInstagram.length > 0,
      // O @ da conta quando é uma só — é o que o usuário reconhece. Sem handle
      // (o fornecedor nem sempre manda), o nome do perfil; nunca um telefone,
      // porque perfil de Instagram não tem um.
      detail:
        connectedInstagram.length === 1
          ? connectedInstagram[0].handle
            ? `@${connectedInstagram[0].handle}`
            : connectedInstagram[0].display_name
          : connectedInstagram.length > 1
            ? `${connectedInstagram.length} contas`
            : undefined,
    },
    google_calendar: {
      connected: !!calendarStatus?.connected,
      detail: calendarStatus?.google_email || undefined,
    },
    tinyerp: {
      connected: !!tinyStatus?.connected,
      detail: tinyStatus?.connected ? "API conectada" : undefined,
    },
    omie: {
      connected: !!omieStatus?.connected,
      detail: omieStatus?.connected ? "Conectado" : undefined,
    },
    elevenlabs: {
      connected: !!orgData?.elevenlabs_api_key,
      detail: orgData?.elevenlabs_api_key ? "Chave configurada" : undefined,
    },
  };
}

type StatusMap = ReturnType<typeof useIntegrationStatuses>;

// ─── Integration Card ───────────────────────────────────

function IntegrationCard({
  integration,
  status,
  onClick,
  index,
}: {
  integration: IntegrationDef;
  status: { connected: boolean; detail?: string };
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25 }}
    >
      <Card
        className="group cursor-pointer transition-all duration-200 hover:shadow-lg hover:border-primary/40 h-full"
        onClick={onClick}
      >
        <CardContent className="p-0">
          {/* Logo area */}
          <div className="flex items-center justify-center p-5 pb-3">
            <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm">
              {integration.logo}
            </div>
          </div>

          {/* Info */}
          <div className="px-4 pb-4 text-center">
            <h3 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">
              {integration.name}
            </h3>

            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mb-3">
              {integration.description}
            </p>

            {/* Status */}
            {status.connected ? (
              <div className="inline-flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Conectado
              </div>
            ) : (
              <button className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                Configurar
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Integration Modal ──────────────────────────────────

function IntegrationModal({
  integration,
  status,
  open,
  onClose,
}: {
  integration: IntegrationDef;
  status: { connected: boolean; detail?: string };
  open: boolean;
  onClose: () => void;
}) {
  const SettingsComponent = getSettingsComponent(integration.settingsId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <DialogHeader>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl overflow-hidden shadow-sm shrink-0">
                {integration.logo}
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg">{integration.name}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {CATEGORY_LABELS[integration.category]}
                </p>
              </div>
              {status.connected ? (
                <Badge className="bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400 shrink-0" variant="outline">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Conectado
                </Badge>
              ) : (
                <Badge variant="secondary" className="shrink-0">
                  <Circle className="w-3 h-3 mr-1" />
                  Disponível
                </Badge>
              )}
            </div>
          </DialogHeader>
        </div>

        {/* Body */}
        <ScrollArea className="max-h-[calc(85vh-120px)]">
          <div className="px-6 py-5 space-y-6">
            {/* About */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Sobre esta integração</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {integration.longDescription}
              </p>
            </div>

            {/* Features */}
            <div>
              <h4 className="text-sm font-semibold mb-2">Recursos</h4>
              <div className="flex flex-wrap gap-2">
                {integration.features.map((f) => (
                  <Badge key={f} variant="secondary" className="text-xs font-normal">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Settings Component */}
            <div className="border-t pt-5">
              <h4 className="text-sm font-semibold mb-4">Configuração</h4>
              {SettingsComponent && <SettingsComponent />}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function getSettingsComponent(settingsId: string): React.FC | null {
  switch (settingsId) {
    case "whatsapp":
      return WhatsAppSettings;
    case "torquecalls":
      return TorqueCallsSettings;
    case "facebook":
      return FacebookSettings;
    case "instagram":
      return InstagramSettings;
    // Canal novo, componente próprio. `InstagramSettings` (Graph) NÃO sai nesta
    // fatia: ela é o único caminho de Instagram que já recebe mensagem, e tirá-la
    // antes de a nova entregar inbox seria regressão, não simplificação.
    case "instagram_oficial":
      return InstagramChannelSettings;
    case "google_calendar":
      return GoogleCalendarSettings;
    case "tinyerp":
      return TinyErpSettings;
    case "omie":
      return OmieSettings;
    case "elevenlabs":
      return ElevenLabsSettings;
    default:
      return null;
  }
}

// ─── Main Catalog ───────────────────────────────────────

export default function IntegrationsCatalog() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<IntegrationCategory | "all">("all");
  const statuses = useIntegrationStatuses();
  const { hasFeature } = useOrgFeatures();
  // Rollout por org, jsonb `organizations.feature_flags`. Fail-closed: enquanto
  // carrega, o cartão não aparece — nunca piscar uma porta que pode não existir.
  const notificameInstagramFlag = useFeatureFlag("notificame_instagram");
  const ROLLOUT_FLAGS: Record<string, boolean> = {
    notificame_instagram: notificameInstagramFlag.enabled,
  };

  // Gate de interface — o servidor já checa a mesma feature em torquecalls-control;
  // isto só evita mostrar um cartão que o plano da organização não paga. O gate
  // de `flagKey` é outra pergunta (rollout, não plano) e some junto com a flag.
  const visibleIntegrations = INTEGRATIONS.filter(
    (i) =>
      (!i.featureKey || hasFeature(i.featureKey)) &&
      (!i.flagKey || ROLLOUT_FLAGS[i.flagKey] === true),
  );

  const connectedCount = visibleIntegrations.filter(
    (i) => statuses[i.id as keyof StatusMap]?.connected,
  ).length;
  const totalCount = visibleIntegrations.length;

  const filtered = visibleIntegrations.filter((i) => {
    const matchesSearch =
      search === "" ||
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === "all" || i.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const selected = visibleIntegrations.find((i) => i.id === selectedId);
  const showGrouped = filterCategory !== "all";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Integrações</h2>
            <Badge variant="secondary" className="ml-1">
              {connectedCount}/{totalCount} conectadas
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte ferramentas externas para ampliar as capacidades do Torque
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar integração..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCategory("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            filterCategory === "all"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          Todos
        </button>
        {CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
        <button
          onClick={() => setFilterCategory("all")}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          Conectadas
        </button>
      </div>

      {/* Grid — flat when "Todos", grouped when filtering by category */}
      {showGrouped ? (
        // Grouped by selected category (only 1 group shows)
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            {CATEGORY_LABELS[filterCategory as IntegrationCategory]}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filtered.map((integration, index) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                status={statuses[integration.id as keyof StatusMap]}
                onClick={() => setSelectedId(integration.id)}
                index={index}
              />
            ))}
          </div>
        </div>
      ) : (
        // Flat grid — all integrations without category dividers
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {filtered.map((integration, index) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              status={statuses[integration.id as keyof StatusMap]}
              onClick={() => setSelectedId(integration.id)}
              index={index}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Plug className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nenhuma integração encontrada</p>
        </div>
      )}

      {/* Modal */}
      {selected && (
        <IntegrationModal
          integration={selected}
          status={statuses[selected.id as keyof StatusMap]}
          open={!!selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
