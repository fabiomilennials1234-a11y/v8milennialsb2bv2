import { Building2, ChevronDown, Check, Loader2, FlaskConical } from "lucide-react";
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
              className="gap-2 max-w-[240px]"
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
