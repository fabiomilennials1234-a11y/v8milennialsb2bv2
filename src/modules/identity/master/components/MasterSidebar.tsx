/**
 * Navegação da área Master.
 *
 * V5 (onda "mais perto do mockup", 02/10): a lateral vermelha de 18 itens
 * virou dois níveis — sete grupos (Dashboard · Organizações · Usuários ·
 * Planos · Saúde · Auditoria · Suporte) e, dentro do grupo, as sub-páginas.
 * Os destinos são EXATAMENTE os mesmos de antes, com os mesmos filtros de
 * permissão — só a forma mudou. O arquivo mantém o nome antigo para não
 * espalhar renomeação.
 *
 * Os grupos são a pílula da página, como em toda tela do V5 (ativo em ouro):
 * o `MasterPageHeader` os publica no centro da barra superior. As sub-páginas
 * ficam na página, num segmentado logo abaixo do título.
 *
 * Outbounder vê apenas Dashboard, Organizações e Usuários.
 * Master (all=true) vê tudo.
 */

import { useEffect, useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useMasterAuth } from "../hooks/useMasterAuth";

interface NavItem {
  label: string;
  path: string;
  /** Se definido, o item só aparece quando a permissão existir (ou all=true) */
  permission?: string;
  /**
   * Item exige master PLENO (`permissions.all`). Usar em telas que expõem
   * dados de TODOS os clientes — o outbounder tem linha em master_users mas
   * é perfil restrito e não pode ver a frota inteira.
   */
  requiresFullMaster?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Os mesmos 18 destinos da lateral antiga, agrupados. Só rótulo, sem ícone:
 * sete pílulas com ícone não cabem no centro da barra (mesma escolha de
 * Configurações).
 */
const MASTER_GROUPS: NavGroup[] = [
  { label: "Dashboard", items: [{ label: "Dashboard", path: "/master" }] },
  {
    label: "Organizações",
    items: [
      { label: "Organizações", path: "/master/organizations", permission: "organizations" },
      { label: "Onboarding", path: "/master/onboarding", permission: "features" },
      { label: "Ativos da Meta", path: "/master/meta-assets", permission: "features" },
      { label: "Etapas Won/Lost", path: "/master/stage-roles", permission: "audit" },
    ],
  },
  {
    label: "Usuários",
    items: [
      { label: "Usuários", path: "/master/users", permission: "users" },
      { label: "Usuários ativos", path: "/master/usuarios-ativos", permission: "users", requiresFullMaster: true },
      { label: "Gestores", path: "/master/gestores", permission: "gestores" },
    ],
  },
  {
    label: "Planos",
    items: [
      { label: "Planos", path: "/master/plans", permission: "billing" },
      { label: "Features", path: "/master/features", permission: "features" },
    ],
  },
  {
    label: "Saúde",
    items: [
      { label: "Operations", path: "/master/operations", permission: "audit" },
      { label: "Automation health", path: "/master/automation-health", permission: "audit" },
      { label: "WhatsApp health", path: "/master/whatsapp-health", permission: "audit" },
      { label: "Qualidade do Oráculo", path: "/master/oraculo-feedback", permission: "audit", requiresFullMaster: true },
      { label: "Copilot reasoning", path: "/master/copilot-reasoning", permission: "audit" },
    ],
  },
  {
    label: "Auditoria",
    items: [
      { label: "Logs de auditoria", path: "/master/audit-logs", permission: "audit" },
      { label: "Copilot toggle audit", path: "/master/copilot-toggle-audit", permission: "audit" },
    ],
  },
  { label: "Suporte", items: [{ label: "Suporte", path: "/master/support-tickets", permission: "support" }] },
];

function pathCasa(atual: string, path: string) {
  return path === "/master" ? atual === "/master" || atual === "/master/" : atual === path || atual.startsWith(`${path}/`);
}

/** Os grupos e sub-páginas que ESTE master pode ver, e o grupo da rota atual. */
function useMasterNav() {
  const { pathname } = useLocation();
  const { permissions } = useMasterAuth();

  const pode = (item: NavItem) => {
    // Itens de frota inteira: só master pleno. Checado ANTES do resto, senão
    // o outbounder passaria pelo `permission: "users"` que ele possui.
    if (item.requiresFullMaster && !permissions.all) return false;
    if (!item.permission) return true; // Dashboard sempre visível
    if (permissions.all) return true; // Master full access
    return !!(permissions as Record<string, boolean>)[item.permission];
  };

  const grupos = MASTER_GROUPS.map((g) => ({ ...g, items: g.items.filter(pode) })).filter((g) => g.items.length > 0);
  const ativo = grupos.find((g) => g.items.some((i) => pathCasa(pathname, i.path))) ?? grupos[0];
  return { grupos, ativo, pathname };
}

/**
 * Nível 1 — a pílula dos grupos. Trocar de grupo abre a primeira sub-página
 * dele. Vai como `tabs` do `PageHeader`, então sobe para a barra superior.
 */
export function MasterGroupTabs() {
  const navigate = useNavigate();
  const { grupos, ativo } = useMasterNav();

  return (
    // `min-w-0 max-w-full` na raiz: sem eles a raiz das abas não encolhe no
    // slot da barra, a pílula vaza da tela em vez de rolar e a aba ativa some.
    <Tabs
      value={ativo?.label}
      onValueChange={(valor) => {
        const grupo = grupos.find((g) => g.label === valor);
        if (grupo) navigate(grupo.items[0].path);
      }}
      className="min-w-0 max-w-full"
    >
      <TabsList variant="pill" aria-label="Seções do Master">
        {grupos.map((g) => (
          <TabsTrigger key={g.label} value={g.label}>
            {g.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Nível 2 — as sub-páginas do grupo atual, quando ele tem mais de uma. */
export function MasterSubNav({ className }: { className?: string }) {
  const { ativo, pathname } = useMasterNav();
  const ref = useRef<HTMLElement>(null);

  // No celular o segmentado de Saúde (cinco páginas) rola: a ativa é trazida
  // para dentro. Só o eixo da faixa — `scrollIntoView` arrastaria a página.
  useEffect(() => {
    const el = ref.current;
    const atual = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !atual) return;
    const left = atual.offsetLeft;
    const right = left + atual.offsetWidth;
    if (left < el.scrollLeft) el.scrollLeft = left - 16;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 16;
  }, [pathname]);

  if (!ativo || ativo.items.length < 2) return null;

  return (
    <nav
      ref={ref}
      aria-label={`Páginas de ${ativo.label}`}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-full bg-muted p-[3px] scrollbar-hide",
        className,
      )}
    >
      {ativo.items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end
          className={({ isActive }) =>
            cn(
              "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
