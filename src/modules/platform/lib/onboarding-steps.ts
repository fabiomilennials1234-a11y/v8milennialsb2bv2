/**
 * onboarding-steps — config único dos passos de onboarding da org.
 *
 * Fonte única de verdade compartilhada entre:
 *   - OnboardingChecklist (pill flutuante, estilo Vercel/Linear)
 *   - OnboardingHub (página dedicada /onboarding, full-page)
 *
 * O estado de cada passo vive em `org_onboarding_progress` (migration 20260422150000):
 * alguns passos são auto-marcados por trigger server-side; os demais podem ser
 * marcados manualmente via `useCompleteOnboardingStep`. Aqui mora apenas a
 * apresentação (label, ícone, deep-link, hint) — nunca o estado.
 */

import {
  Wifi,
  Users,
  Bot,
  Workflow,
  UserPlus,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { OnboardingStepKey } from "@/modules/platform/hooks/onboarding/useOnboardingChecklist";

export type OnboardingSectionKey = "essencial" | "inteligencia" | "time";

export interface OnboardingSection {
  key: OnboardingSectionKey;
  label: string;
  description: string;
}

/** Seções (apresentação) — agrupam os passos. Ordem = ordem de render. */
export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  {
    key: "essencial",
    label: "Configuração essencial",
    description: "O básico pra começar a conversar e receber leads.",
  },
  {
    key: "inteligencia",
    label: "Inteligência & automação",
    description: "Deixe a IA e os fluxos trabalharem por você.",
  },
  {
    key: "time",
    label: "Time & primeiras vendas",
    description: "Traga o time e feche os primeiros negócios.",
  },
];

export interface OnboardingStepConfig {
  key: OnboardingStepKey;
  section: OnboardingSectionKey;
  label: string;
  icon: LucideIcon;
  href: string;
  hint: string;
  /** Link do tutorial em vídeo (YouTube). Vazio = sem tutorial ainda. */
  tutorialUrl: string;
}

export const ONBOARDING_STEPS: OnboardingStepConfig[] = [
  {
    key: "step_connect_whatsapp",
    section: "essencial",
    label: "Conectar WhatsApp",
    icon: Wifi,
    href: "/configuracoes?tab=whatsapp",
    hint: "Vincule sua instância WhatsApp para começar a conversar",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
  {
    key: "step_import_lead",
    section: "essencial",
    label: "Importar primeiro lead",
    icon: Users,
    href: "/leads",
    hint: "Adicione ou importe pelo menos um lead ao sistema",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
  {
    key: "step_configure_copilot",
    section: "inteligencia",
    label: "Configurar agente IA",
    icon: Bot,
    href: "/copilot",
    hint: "Crie um agente de IA para automatizar suas conversas",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
  {
    key: "step_create_workflow",
    section: "inteligencia",
    label: "Criar automação",
    icon: Workflow,
    href: "/automacoes",
    hint: "Configure um fluxo de automação para seu processo de vendas",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
  {
    key: "step_add_member",
    section: "time",
    label: "Adicionar membro ao time",
    icon: UserPlus,
    href: "/equipe",
    hint: "Convide um SDR ou Closer para colaborar com você",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
  {
    key: "step_first_sale",
    section: "time",
    label: "Fechar primeira venda",
    icon: Trophy,
    href: "/funis",
    hint: "Mova um lead para 'Vendido' no pipe de propostas",
    tutorialUrl: "", // TODO CTO: link do tutorial
  },
];
