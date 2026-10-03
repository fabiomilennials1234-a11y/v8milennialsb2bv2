/**
 * Registro das abas de Configurações — fonte única de verdade.
 *
 * Antes deste arquivo, as abas existiam só como `<PillTab>` dentro de
 * `Configuracoes.tsx` e eram alcançáveis apenas por `?tab=`. No desktop nada
 * levava a `/configuracoes`: o gatilho do Pitstop só abre o painel, e o painel
 * não listava a tela. Resultado: a tela existia e não era acessível.
 *
 * Agora as três abas de uso diário — Tags, Notificações e WhatsApp — têm rota
 * própria (`/configuracoes/<slug>`) e item no Pitstop. O resto fica atrás de uma
 * porta só, `/configuracoes/outros`, e se identifica por `?tab=`: treze entradas
 * num painel lateral custam mais do que resolvem.
 *
 * O `value` é o que o Radix usa (e o que `?tab=` sempre aceitou); o `slug` é o
 * que vai na URL das primárias. Divergem de propósito em `notifications`→
 * `notificacoes` e `general`→`geral` (URL em pt-BR). Os slugs das não-primárias
 * sobrevivem só para `resolveSettingsTab` reconhecer link antigo e redirecionar.
 *
 * Só dado — sem React, sem Supabase. Quem decide visibilidade é
 * `useNavigationModel` (Pitstop) e a própria página (abas).
 */

import {
  Award,
  Bell,
  BrainCircuit,
  ClipboardList,
  Code,
  CreditCard,
  FlaskConical,
  HelpCircle,
  Key,
  MessageSquare,
  Plug,
  Settings,
  Tag,
  Timer,
  Webhook,
} from "lucide-react";

export interface SettingsTab {
  /** Valor do Radix `Tabs` — é também o que `?tab=` sempre aceitou. */
  value: string;
  /** Segmento de URL das abas com rota própria: `/configuracoes/<slug>`. */
  slug: string;
  label: string;
  icon: React.ElementType;
  /**
   * Rota própria + item no Pitstop. Só as três de uso diário — decisão do CTO:
   * o painel é lateral, e treze entradas nele custam mais do que resolvem. O
   * resto vive sob "Outros".
   */
  primary?: boolean;
  /** Aba só existe para admin (a autoria da Central de Ajuda). */
  adminOnly?: boolean;
  /** Aba só existe em org outbound (Marcos). */
  outboundOnly?: boolean;
  /**
   * V5 (CTO, 02/10): a aba deixou de ser aba e virou SEÇÃO de outra — `group`
   * é o `value` da aba que a hospeda. O endereço antigo continua resolvendo:
   * abre o grupo já rolado até a seção.
   */
  group?: string;
  /** A aba saiu das Configurações e mora em outra tela (Checklists → /checklists). */
  redirect?: string;
  /** Frase do cabeçalho quando a aba está aberta. */
  subtitle?: string;
}

/**
 * Sete abas, decisão do CTO de 02/10 (eram quinze, que rolavam na pílula):
 * Tags · Notificações · WhatsApp · Integrações · Assinatura e cobrança ·
 * API & Webhooks · Geral. Todas com rota própria. As antigas continuam no
 * registro como seções (`group`) ou desvio (`redirect`), para link velho não
 * quebrar.
 */
export const SETTINGS_TABS: SettingsTab[] = [
  {
    value: "tags",
    slug: "tags",
    label: "Tags",
    icon: Tag,
    primary: true,
    subtitle: "Tags organizam os leads e disparam automações.",
  },
  {
    value: "notifications",
    slug: "notificacoes",
    label: "Notificações",
    icon: Bell,
    primary: true,
    subtitle: "O que te avisa, como e quando.",
  },
  {
    value: "whatsapp",
    slug: "whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    primary: true,
    subtitle: "Números conectados, quem atende cada caixa e o canal oficial.",
  },
  {
    value: "integracoes",
    slug: "integracoes",
    label: "Integrações",
    icon: Plug,
    primary: true,
    subtitle: "Conecte o Torque às ferramentas que a operação já usa.",
  },
  {
    value: "billing",
    slug: "assinatura",
    label: "Assinatura e cobrança",
    icon: CreditCard,
    primary: true,
    adminOnly: true,
    subtitle: "Plano, limites de uso e histórico de cobranças.",
  },
  {
    value: "api-webhooks",
    slug: "api-webhooks",
    label: "API & Webhooks",
    icon: Code,
    primary: true,
    subtitle: "Chaves de API, webhooks de saída e a entrada de leads por webhook.",
  },
  {
    value: "general",
    slug: "geral",
    label: "Geral",
    icon: Settings,
    primary: true,
    subtitle: "Empresa, atendimento e os ajustes que valem para a organização inteira.",
  },
  // ── Seções das abas acima (endereços antigos) ───────────────────────────────
  { value: "webhooks", slug: "webhooks", label: "Webhooks", icon: Webhook, group: "api-webhooks" },
  { value: "api", slug: "api-docs", label: "API & Chaves", icon: Code, group: "api-webhooks" },
  { value: "api-keys", slug: "api-keys", label: "API Keys", icon: Key, group: "api-webhooks" },
  { value: "sla", slug: "sla", label: "SLA", icon: Timer, group: "general" },
  { value: "sandbox", slug: "sandbox", label: "Sandbox", icon: FlaskConical, group: "general" },
  { value: "oraculo-profile", slug: "perfil-operacao", label: "Perfil da operação", icon: BrainCircuit, group: "general" },
  { value: "marcos", slug: "marcos", label: "Marcos", icon: Award, outboundOnly: true, group: "general" },
  { value: "ajuda", slug: "ajuda", label: "Central de Ajuda", icon: HelpCircle, adminOnly: true, group: "general" },
  // Duplicava `/checklists` (Pitstop › Rotas). Link antigo vai para lá.
  { value: "checklists", slug: "checklists", label: "Checklists", icon: ClipboardList, redirect: "/checklists" },
];

export const SETTINGS_BASE_PATH = "/configuracoes";

/** Porta única do que não é primário. As abas de lá se trocam por `?tab=`. */
export const SETTINGS_OTHERS_SLUG = "outros";
export const SETTINGS_OTHERS_PATH = `${SETTINGS_BASE_PATH}/${SETTINGS_OTHERS_SLUG}`;
export const SETTINGS_OTHERS_LABEL = "Outros";

export const DEFAULT_SETTINGS_TAB = SETTINGS_TABS[0];

export const isPrimarySettingsTab = (tab: SettingsTab): boolean => tab.primary === true;

/**
 * Endereço canônico de uma aba. Primária tem rota própria; o resto mora sob
 * "Outros" e se identifica por `?tab=` — assim o link continua reabrindo a
 * mesma aba sem que cada ajuste vire rota e item de painel.
 */
export const settingsTabPath = (tab: SettingsTab): string => {
  if (tab.redirect) return tab.redirect;
  if (tab.group) {
    const host = SETTINGS_TABS.find((t) => t.value === tab.group);
    if (host) return `${SETTINGS_BASE_PATH}/${host.slug}?secao=${tab.value}`;
  }
  return isPrimarySettingsTab(tab)
    ? `${SETTINGS_BASE_PATH}/${tab.slug}`
    : `${SETTINGS_OTHERS_PATH}?tab=${tab.value}`;
};

/** A aba que hospeda uma seção (ou a própria aba, se não for seção). */
export const hostSettingsTab = (tab: SettingsTab): SettingsTab =>
  (tab.group && SETTINGS_TABS.find((t) => t.value === tab.group)) || tab;

/** Rotas reais (sem query) — usado para semear a matriz de permissão de view. */
export const SETTINGS_TAB_PATHS: string[] = [
  ...SETTINGS_TABS.filter(isPrimarySettingsTab).map((tab) => `${SETTINGS_BASE_PATH}/${tab.slug}`),
  SETTINGS_OTHERS_PATH,
];

export interface SettingsTabVisibility {
  isAdmin: boolean;
  isOutboundOrg: boolean;
}

const podeVer = (tab: SettingsTab, { isAdmin, isOutboundOrg }: SettingsTabVisibility) =>
  (!tab.adminOnly || isAdmin) && (!tab.outboundOnly || isOutboundOrg);

/** As ABAS (pílulas) visíveis — sem seções nem desvios. */
export function visibleSettingsTabs(visibility: SettingsTabVisibility): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => !tab.group && !tab.redirect && podeVer(tab, visibility));
}

/** As seções de uma aba-grupo que este usuário pode ver. */
export function visibleSettingsSections(groupValue: string, visibility: SettingsTabVisibility): SettingsTab[] {
  return SETTINGS_TABS.filter((tab) => tab.group === groupValue && podeVer(tab, visibility));
}

/** Seção visível? (Marcos fora de outbound e Ajuda sem admin não.) */
export const canSeeSettingsTab = podeVer;

/** As abas com rota própria — as portas do Pitstop. */
export const visiblePrimarySettingsTabs = (v: SettingsTabVisibility): SettingsTab[] =>
  visibleSettingsTabs(v).filter(isPrimarySettingsTab);

/** O que mora sob "Outros" — a fila de pílulas daquela rota. */
export const visibleOtherSettingsTabs = (v: SettingsTabVisibility): SettingsTab[] =>
  visibleSettingsTabs(v).filter((tab) => !isPrimarySettingsTab(tab));

/**
 * Resolve o que veio da URL. Aceita slug (rota) e value (`?tab=`), porque links
 * antigos — e os do onboarding — usam a segunda forma, e porque as abas de
 * "Outros" se identificam só por value.
 * Devolve `null` quando não reconhece, para a página cair no padrão.
 */
export function resolveSettingsTab(input: string | null | undefined): SettingsTab | null {
  if (!input) return null;
  if (input === SETTINGS_OTHERS_SLUG) return null;
  return (
    SETTINGS_TABS.find((tab) => tab.slug === input) ??
    SETTINGS_TABS.find((tab) => tab.value === input) ??
    null
  );
}
