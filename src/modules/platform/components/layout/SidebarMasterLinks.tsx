import { LineChart, Shield } from "lucide-react";
import { NavLink } from "react-router-dom";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMasterAuth, MasterOnlineIndicator } from "@/modules/identity";

/**
 * Atalhos de master no RODAPÉ da barra lateral.
 *
 * ── DE ONDE ELES VIERAM, E POR QUE SAÍRAM DE LÁ ───────────────────────────
 * Master, Gestor e o indicador de usuários ativos moravam dentro do
 * `OrgSwitcher`, no TOPO da lateral, numa linha `flex` junto do seletor de
 * organização. Quatro controles — com o seletor sozinho indo a 240px — não
 * cabem na largura da barra: a linha transbordava e os botões apareciam por
 * cima da área de conteúdo. Na tela isso lia como "botões soltos no meio do
 * Comando"; a causa era largura, não posição.
 *
 * Aqui eles são o que sempre foram: atalhos de navegação que não pertencem ao
 * funil. Ficam junto de Agenda, Notificações e Ajuda, herdam o recolhimento do
 * menu (que no topo eles não tinham — o `OrgSwitcher` inteiro sumia no modo
 * recolhido, levando o acesso ao painel Master junto) e não competem por
 * espaço com nada.
 *
 * ── QUEM VÊ O QUÊ ────────────────────────────────────────────────────────
 * `isMaster` cobre Master e Gestor. O indicador se governa por conta própria
 * com `isFullMaster` — o outbounder tem linha em `master_users` mas é perfil
 * restrito e não pode ver a frota inteira. Por isso o número NÃO é escondido
 * por este componente: quem sabe a regra é ele.
 */

function Linha({
  to,
  icone: Icone,
  rotulo,
  collapsed,
  tom,
}: {
  to: string;
  icone: typeof Shield;
  rotulo: string;
  collapsed: boolean;
  /** Classe de cor do ícone — o que distingue Master de Gestor de relance. */
  tom: string;
}) {
  const conteudo = (
    <NavLink
      to={to}
      className={cn(
        "flex items-center rounded-lg py-2 text-sm text-sidebar-foreground/70 transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center" : "gap-3 px-2.5",
      )}
    >
      <Icone className={cn("h-[17px] w-[17px] shrink-0", tom)} />
      {!collapsed && <span className="flex-1 truncate">{rotulo}</span>}
    </NavLink>
  );

  if (!collapsed) return conteudo;

  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{conteudo}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {rotulo}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarMasterLinks({ collapsed }: { collapsed: boolean }) {
  const { isMaster, isOutbounder } = useMasterAuth();

  if (!isMaster) return null;

  return (
    <>
      <Linha
        to="/master"
        icone={Shield}
        // O outbounder entra pela mesma porta com outro nome — o painel dele é
        // restrito, e chamá-lo de "Master" prometeria o que a tela não entrega.
        rotulo={isOutbounder ? "Painel Outbound" : "Master"}
        collapsed={collapsed}
        tom="text-red-500 dark:text-red-400"
      />
      <Linha
        to="/insights"
        icone={LineChart}
        rotulo="Gestor"
        collapsed={collapsed}
        tom="text-insights"
      />
      <MasterOnlineIndicator forma="lateral" collapsed={collapsed} />
    </>
  );
}
