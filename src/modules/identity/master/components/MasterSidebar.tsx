/**
 * Navegação da área Master — as 5 centrais da Área Dev.
 *
 * Board "Área Dev: 18 telas → 5 centrais" (02/10): Operação · Implementação ·
 * Organizações · Monitoramento · Testes. Nenhum dado ficou solto: cada uma das
 * 18 telas antigas mora numa central, como página principal ou como aba.
 * Operação vem primeiro — o dia começa pela fila de chamados.
 *
 * As centrais são a pílula da página (ativo em ouro), publicada pelo
 * `MasterPageHeader` no centro da barra superior; as abas da central ficam na
 * página, num segmentado logo abaixo do título.
 *
 * Permissão (regra PE-4): cada central tem a sua chave em
 * `master_users.permissions` (`operacao`, `implementacao`, `organizacoes`,
 * `monitoramento`, `testes`). As chaves antigas continuam valendo item a item
 * — quem tinha `support` continua vendo os chamados, o outbounder continua
 * vendo só Organizações. `all` vê tudo.
 */

import { useEffect, useRef } from "react";
import { Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { MASTER_GROUPS, canSeeNavItem, type NavItem } from "../lib/master-nav";

function pathCasa(atual: string, path: string) {
  return path === "/master" ? atual === "/master" || atual === "/master/" : atual === path || atual.startsWith(`${path}/`);
}

/** Os grupos e sub-páginas que ESTE master pode ver, e o grupo da rota atual. */
function useMasterNav() {
  const { pathname } = useLocation();
  const { permissions } = useMasterAuth();

  const pode = (item: NavItem) => canSeeNavItem(item, permissions as Record<string, unknown>);

  const grupos = MASTER_GROUPS.map((g) => ({ ...g, items: g.items.filter(pode) })).filter((g) => g.items.length > 0);
  const ativo = grupos.find((g) => g.items.some((i) => pathCasa(pathname, i.path))) ?? grupos[0];
  return { grupos, ativo, pathname };
}

/**
 * `/master` abre a primeira central que este master pode ver — Operação para
 * o master pleno, Organizações para o outbounder.
 */
export function MasterIndexRedirect() {
  const { grupos } = useMasterNav();
  const destino = grupos[0]?.items[0]?.path ?? "/master/panorama";
  return <Navigate to={destino} replace />;
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
