import { Building2, ChevronDown, ChevronsUpDown, Check, Loader2, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useOrgSwitcher } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
// Fica só pelo selo SHADOW: master lendo a org de um cliente precisa saber que
// está de empréstimo. Os ATALHOS de master mudaram de lugar — ver o bloco acima.
import { useMasterAuth } from "@/modules/identity";

/**
 * Trocar de organização — e só isso.
 *
 * ── POR QUE OS ATALHOS DE MASTER SAÍRAM DAQUI ─────────────────────────────
 * Este componente é montado no TOPO da barra lateral (`Sidebar.tsx`), que tem
 * largura fixa. Enquanto ele carregava, além do seletor, os botões "Master" e
 * "Gestor" e o indicador de usuários ativos, a linha somava quatro controles —
 * o dropdown sozinho vai a 240px — e **transbordava a lateral**, aparecendo por
 * cima da área de conteúdo. Da tela, a leitura era de botões soltos no meio do
 * Comando; a causa era largura, não posicionamento.
 *
 * Os três viraram linhas do RODAPÉ da lateral (`SidebarMasterLinks`), junto de
 * Agenda e Notificações, que é onde moram os atalhos que não são navegação de
 * funil. Lá eles herdam o comportamento de recolher junto com o menu, que aqui
 * nunca tiveram — `Sidebar.tsx` já os escondia por inteiro no modo recolhido.
 *
 * ── POR QUE O GATILHO CARREGA `text-sidebar-foreground` ───────────────────
 * `variant="ghost"` não declara cor de texto em REPOUSO — só no hover. Em
 * repouso o rótulo herda de quem o contém, e este componente é montado sempre
 * sobre a lateral, que é ESCURA nos dois temas (`--sidebar-background` é
 * 36 20% 18% no tema claro, não só no escuro).
 *
 * Sem cor explícita, no tema claro o nome da org herdava `--foreground`
 * (30 18% 16%) — praticamente o mesmo tom do fundo da lateral: 1.10:1, texto
 * invisível. O único elemento que aparecia era o selo SHADOW, e só porque ele
 * traz `text-yellow-600` próprio. No tema escuro a herança calhava de dar
 * 18.80:1, e por isso o defeito passou despercebido.
 *
 * `Sidebar.tsx`/`SidebarMobileDrawer.tsx` já ancoram a herança no contêiner; a
 * classe aqui é o que mantém o componente correto por si, em qualquer
 * superfície onde venha a ser montado.
 */
export function OrgSwitcher() {
  const { orgs, hasMultipleOrgs, isSwitching, switchOrg } = useOrgSwitcher();
  const { organizationId } = useOrganization();
  const { isMaster } = useMasterAuth();

  // Sem segunda org não há o que trocar. O master também cai nesta regra: o
  // acesso dele à visão de frota é pelo rodapé, não por um seletor de uma org só.
  if (!hasMultipleOrgs) return null;

  const currentOrg = orgs.find((o) => o.id === organizationId);

  return (
    <div className="flex items-center gap-2">
      {hasMultipleOrgs && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 max-w-[240px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              disabled={isSwitching}
            >
              {isSwitching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Building2 className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate text-sm font-medium">
                {currentOrg?.name ?? "Selecionar org..."}
              </span>
              {currentOrg?.name?.includes("[Sandbox]") && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600 gap-0.5">
                  <FlaskConical className="w-2.5 h-2.5" />
                  SANDBOX
                </Badge>
              )}
              {isMaster && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-yellow-500/50 text-yellow-600">
                  SHADOW
                </Badge>
              )}
              <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[220px] max-h-[400px] overflow-y-auto">
            {orgs.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => {
                  if (org.id !== organizationId) {
                    switchOrg(org.id);
                  }
                }}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{org.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {org.name?.includes("[Sandbox]") && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/50 text-amber-600">
                      SBX
                    </Badge>
                  )}
                  {org.org_type === "outbound" && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                      OUT
                    </Badge>
                  )}
                  {org.id === organizationId && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

    </div>
  );
}

/** Iniciais da org para o ladrilho do chip ("Comercial Milennials" → "CM"). */
function iniciais(nome: string | undefined) {
  if (!nome) return "·";
  const partes = nome.replace(/\[.*?\]/g, "").trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "·";
}

/** Tom estável por nome — o ladrilho da org não muda de cor entre visitas. */
function tomDaOrg(nome: string | undefined) {
  let h = 0;
  for (const c of nome ?? "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 42% 38%)`;
}

/**
 * V5 — a organização como chip na barra superior: ladrilho com iniciais, nome
 * e o plano. Com mais de uma org o chip abre a troca (mesmo menu de sempre);
 * com uma só ele é identificação, não botão — gatilho que não abre nada é
 * botão morto.
 */
export function OrgChip({ compact = false }: { compact?: boolean }) {
  const { orgs, hasMultipleOrgs, isSwitching, switchOrg } = useOrgSwitcher();
  const { organizationId } = useOrganization();
  const { isMaster } = useMasterAuth();
  const { planName } = useOrgFeatures();

  const currentOrg = orgs.find((o) => o.id === organizationId);
  const nome = currentOrg?.name;
  const plano = planName && planName !== "free" ? planName : null;

  const corpo = (
    <>
      <span
        aria-hidden
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[12px] text-[10px] font-extrabold text-white"
        style={{ backgroundColor: tomDaOrg(nome) }}
      >
        {isSwitching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : iniciais(nome)}
      </span>
      {!compact && <span className="max-w-[180px] truncate text-xs font-bold text-foreground">{nome ?? "Organização"}</span>}
      {plano && (
        <span className="rounded-full bg-tinta px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
          {plano}
        </span>
      )}
      {isMaster && !compact && (
        <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold text-warning-strong">SHADOW</span>
      )}
      {hasMultipleOrgs && !compact && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
    </>
  );

  const casca =
    "inline-flex min-w-0 items-center gap-2 rounded-full border border-card-border bg-card py-[5px] pl-[5px] pr-2.5 shadow-relevo";

  if (!hasMultipleOrgs) {
    return (
      <div className={casca} title={nome}>
        {corpo}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isSwitching}
          aria-label={`Organização: ${nome ?? "selecionar"}. Trocar organização`}
          className={cn(casca, "transition-shadow hover:shadow-relevo-alto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
        >
          {corpo}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[400px] w-[240px] overflow-y-auto">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => {
              if (org.id !== organizationId) switchOrg(org.id);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{org.name}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {org.org_type === "outbound" && (
                <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                  OUT
                </Badge>
              )}
              {org.id === organizationId && <Check className="h-4 w-4 text-primary" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
