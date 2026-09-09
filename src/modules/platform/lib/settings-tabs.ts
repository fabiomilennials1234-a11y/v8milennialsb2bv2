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
  ClipboardList,
  Code,
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
}

export const SETTINGS_TABS: SettingsTab[] = [
  { value: "tags", slug: "tags", label: "Tags", icon: Tag, primary: true },
  {
    value: "notifications",
    slug: "notificacoes",
    label: "Notificações",
    icon: Bell,
    primary: true,
  },
  { value: "whatsapp", slug: "whatsapp", label: "WhatsApp", icon: MessageSquare, primary: true },
  { value: "integracoes", slug: "integracoes", label: "Integrações", icon: Plug },
  { value: "webhooks", slug: "webhooks", label: "Webhooks", icon: Webhook },
  { value: "api", slug: "api-docs", label: "API & Chaves", icon: Code },
  { value: "sla", slug: "sla", label: "SLA", icon: Timer },
  { value: "api-keys", slug: "api-keys", label: "API Keys", icon: Key },
  { value: "sandbox", slug: "sandbox", label: "Sandbox", icon: FlaskConical },
  { value: "checklists", slug: "checklists", label: "Checklists", icon: ClipboardList },
  { value: "general", slug: "geral", label: "Geral", icon: Settings },
  { value: "marcos", slug: "marcos", label: "Marcos", icon: Award, outboundOnly: true },
  { value: "ajuda", slug: "ajuda", label: "Central de Ajuda", icon: HelpCircle, adminOnly: true },
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
export const settingsTabPath = (tab: SettingsTab): string =>
  isPrimarySettingsTab(tab)
    ? `${SETTINGS_BASE_PATH}/${tab.slug}`
    : `${SETTINGS_OTHERS_PATH}?tab=${tab.value}`;

/** Rotas reais (sem query) — usado para semear a matriz de permissão de view. */
export const SETTINGS_TAB_PATHS: string[] = [
  ...SETTINGS_TABS.filter(isPrimarySettingsTab).map((tab) => `${SETTINGS_BASE_PATH}/${tab.slug}`),
  SETTINGS_OTHERS_PATH,
];

export interface SettingsTabVisibility {
  isAdmin: boolean;
  isOutboundOrg: boolean;
}

export function visibleSettingsTabs({
  isAdmin,
  isOutboundOrg,
}: SettingsTabVisibility): SettingsTab[] {
  return SETTINGS_TABS.filter(
    (tab) => (!tab.adminOnly || isAdmin) && (!tab.outboundOnly || isOutboundOrg),
  );
}

/** As três com rota própria — as portas do Pitstop. */
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
