/**
 * Navegação lateral — V5: trilho de ícones de 76 px (decisão do CTO, 02/10).
 *
 * Sem rótulos e sem expandir: o nome de cada porta mora no tooltip, e o que
 * antes ocupava a lateral larga foi para onde o olho já está —
 * organização, busca, notificações, tema e usuário na barra superior
 * (`TopBar`); a troca de funil na própria página do funil.
 *
 * De cima para baixo: marca · Comando, Métricas, Chat, Disparos, Funis, Leads ·
 * Copilot, Automações (o grupo "Turbo" achatado) · Oráculo · e no rodapé
 * Agenda, Master, Ajuda, Pitstop e o avatar.
 *
 * Agenda, Oráculo e Pitstop deixaram de abrir painel por cima da tela: são
 * páginas (`/agenda`, `/oraculo`, `/pitstop`). Os componentes de painel
 * continuam no repositório — só não são montados aqui.
 *
 * O componente não decide visibilidade — isso é `useNavigationModel`. Aqui só
 * se decide forma.
 */

import { forwardRef, useCallback, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Bot, CalendarDays, HelpCircle, Settings, Shield, Sparkles, Workflow } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import { usePrefetchPipes } from "@/modules/pipelines";
import { useOraculoBriefing } from "@/modules/copilot";
import { useMasterAuth, useOrganizationSettings } from "@/modules/identity";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";
import { PITSTOP_HUB_PATH, RAIL_WIDTH, type NavNode } from "@/modules/platform/lib/navigation-model";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";
import { SidebarBrand } from "./SidebarBrand";
import { SidebarMasterLinks } from "./SidebarMasterLinks";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarUserMenu } from "./SidebarUserMenu";

const ICONE_DO_TURBO: Record<string, React.ElementType> = {
  "/copilot": Bot,
  "/automacoes": Workflow,
};

/** Fio de 28 px entre os grupos do trilho. */
function Separador() {
  return <span aria-hidden className="my-1 h-px w-7 shrink-0 bg-sidebar-border" />;
}

/** Botão do trilho que não é link de rota simples (Oráculo, Master). */
type RailButtonProps = {
  label: string;
  active?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

// forwardRef: o escudo do Master é gatilho de Popover, que ancora pela ref.
const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
  { label, active = false, children, className, ...rest },
  ref,
) {
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cn(
            "group relative grid h-[42px] w-[46px] shrink-0 place-items-center rounded-[14px] transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar",
            active
              ? "bg-sidebar-accent text-primary"
              : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            className,
          )}
          {...rest}
        >
          {active && (
            <span
              aria-hidden
              className="absolute -left-[15px] top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/.65)]"
            />
          )}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={14} className="max-w-[260px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
});

export function Sidebar() {
  const model = useNavigationModel();
  const prefetchPipes = usePrefetchPipes();
  const location = useLocation();
  const navigate = useNavigate();
  const briefing = useOraculoBriefing();
  const { isMaster, isOutbounder } = useMasterAuth();
  const { settings } = useOrganizationSettings();
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  const openUpgrade = useCallback(
    (path: string) => {
      const key = model.featureKeyFor(path);
      if (key) setUpgradeFeature(key);
    },
    [model],
  );

  // Funis no trilho abre o funil PADRÃO da org (o hub virou a aba "Todos os
  // funis" dentro da página). Sem padrão, cai no hub.
  const funilPadrao = settings?.default_pipeline_id ? `/funil/${settings.default_pipeline_id}` : "/funis";

  const principais = model.primary.filter((item) => item.path !== "/turbo");
  const turbo = model.primary.find((item) => item.path === "/turbo")?.children ?? [];

  const renderItem = (item: NavNode, overrides?: Partial<NavNode>) => (
    <SidebarNavItem
      key={item.path}
      rail
      collapsed
      item={{ ...item, children: undefined, expandOnly: undefined, ...overrides }}
      active={model.isActive(item.path)}
      locked={model.isLocked(item.path)}
      onLockedClick={() => openUpgrade(item.path)}
      onHoverPrefetch={item.path === "/funis" ? prefetchPipes : undefined}
    />
  );

  const atual = briefing.briefing;
  const oraculoAtivo = location.pathname.startsWith("/oraculo");
  const abrirOraculo = () => {
    if (!atual) {
      navigate("/oraculo");
      return;
    }
    // O briefing abre a conversa contextual dele, agora na página do Oráculo.
    void briefing
      .open(atual.id)
      .then((opened) => navigate(`/oraculo?conversa=${opened.conversa_id}`))
      .catch(() => navigate("/oraculo"));
  };

  return (
    <>
      {/* `text-sidebar-foreground` no <aside> não é decoração: a lateral é ESCURA
          nos dois temas, e quem não declarava cor herdava `--foreground`
          (quase o tom do fundo no tema claro, 1.10:1). */}
      <aside
        data-testid="sidebar"
        aria-label="Navegação principal"
        style={{ width: RAIL_WIDTH }}
        className="relative z-30 m-3 mr-0 flex h-[calc(100vh-1.5rem)] shrink-0 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden rounded-panel border border-sidebar-border bg-sidebar pb-3 pt-3.5 text-sidebar-foreground shadow-relevo-tinta scrollbar-hide"
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center">
          <SidebarBrand collapsed />
        </div>

        <nav aria-label="Telas" className="flex flex-col items-center gap-1.5">
          {principais.map((item) =>
            item.path === "/funis" ? renderItem(item, { path: funilPadrao }) : renderItem(item),
          )}

          {turbo.length > 0 && <Separador />}
          {turbo.map((item) => renderItem(item, { icon: ICONE_DO_TURBO[item.path] ?? item.icon }))}

          <Separador />
          <RailButton
            label={atual?.headline ? `Oráculo — ${atual.headline}` : "Oráculo"}
            active={oraculoAtivo}
            onClick={abrirOraculo}
          >
            <Sparkles className="h-[19px] w-[19px]" strokeWidth={1.7} />
            {atual?.status === "new" && (
              <span
                aria-hidden
                className="absolute right-[7px] top-[7px] h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary"
              />
            )}
          </RailButton>
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
          {model.agenda && renderItem(model.agenda, { icon: CalendarDays })}

          {/* Master, Gestor e "Ativos agora" moram num popover do escudo — no
              trilho não há largura para três linhas. */}
          {isMaster && (
            <Popover>
              <PopoverTrigger asChild>
                <RailButton
                  label={isOutbounder ? "Painel Outbound" : "Master"}
                  active={location.pathname.startsWith("/master") || location.pathname.startsWith("/insights")}
                >
                  <Shield className="h-[19px] w-[19px] text-destructive" strokeWidth={1.7} />
                </RailButton>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="end"
                sideOffset={14}
                className="w-56 border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
              >
                <SidebarMasterLinks collapsed={false} />
              </PopoverContent>
            </Popover>
          )}

          <Tooltip delayDuration={120}>
            <TooltipTrigger asChild>
              <NavLink
                to="/faq"
                aria-label="Ajuda"
                className={({ isActive }) =>
                  cn(
                    "relative grid h-[42px] w-[46px] place-items-center rounded-[14px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-sidebar-accent text-primary"
                      : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )
                }
              >
                <HelpCircle className="h-[19px] w-[19px]" strokeWidth={1.7} />
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={14}>
              Ajuda
            </TooltipContent>
          </Tooltip>

          {model.pitstop && model.pitstopGroups.length > 0 && (
            <SidebarNavItem
              rail
              collapsed
              item={{ label: "Pitstop", icon: Settings, path: PITSTOP_HUB_PATH }}
              active={model.isPitstopRoute}
            />
          )}

          <div className="pt-1.5">
            <SidebarUserMenu variant="rail" />
          </div>
        </div>
      </aside>

      {upgradeFeature && (
        <UpgradeModal
          open
          onOpenChange={(open) => !open && setUpgradeFeature(null)}
          featureKey={upgradeFeature}
        />
      )}
    </>
  );
}
