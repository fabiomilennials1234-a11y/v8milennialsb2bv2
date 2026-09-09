import {
  Briefcase,
  Gift,
  Heart,
  Kanban,
  ShoppingBag,
  Star,
  Target,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Mapa CANÔNICO ícone-do-funil → componente (SCRUM-637).
 *
 * `pipelines.icon` guarda o nome escolhido no criador de funil
 * (`CreateFunilOuCampanhaModal` / `FunnelIdentitySection`); todo lugar que
 * desenha um funil — página unificada, hub, lateral — resolve por AQUI.
 * Antes eram 4 cópias divergentes (Funil.tsx, CustomPipeline.tsx,
 * TopNavigation.tsx ×2); a divergência aparecia como funil com ícone certo
 * numa tela e Kanban genérico na outra.
 */
export const FUNIL_ICON_MAP: Record<string, LucideIcon> = {
  kanban: Kanban,
  target: Target,
  users: Users,
  "shopping-bag": ShoppingBag,
  heart: Heart,
  briefcase: Briefcase,
  star: Star,
  zap: Zap,
  gift: Gift,
};

/** Resolve o ícone de um funil; nome desconhecido/nulo cai no Kanban. */
export function funilIcon(name: string | null | undefined): LucideIcon {
  return (name && FUNIL_ICON_MAP[name]) || Kanban;
}
