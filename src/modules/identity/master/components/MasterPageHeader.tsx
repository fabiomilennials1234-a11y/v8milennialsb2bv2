/**
 * Cabeçalho de toda página master.
 *
 * O título é da página ("Usuários", "Feature flags"…). A área master entra
 * como moldura em volta dele, igual em todas (mockup V5):
 *   - a pílula dos grupos (`MasterGroupTabs`) sobe para o centro da barra
 *     superior, pelo mesmo `tabs` do `PageHeader` que as outras telas usam;
 *   - o selo "Modo master" abre as ações, antes do primário da página;
 *   - abaixo do título, as sub-páginas do grupo e a faixa vermelha.
 *
 * Mora na página, e não no `MasterLayout`, porque o `PageHeader` só publica a
 * pílula junto com um título: um cabeçalho no layout e outro na página davam
 * dois títulos. Por isso página master usa este componente, nunca o
 * `PageHeader` cru — inclusive nos estados de acesso negado e de carga, senão
 * a navegação some (`tests/unit/master-page-header.test.ts` trava isso).
 *
 * `tabs` aqui são as abas da PRÓPRIA página (Operations, Onboarding…): ficam
 * na página, logo acima do conteúdo, porque o centro da barra já é dos grupos.
 */

import type { ComponentProps, ReactNode } from "react";
import { Shield } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { useMasterAuth } from "../hooks/useMasterAuth";
import { MasterGroupTabs, MasterSubNav } from "./MasterSidebar";

type MasterPageHeaderProps = Omit<ComponentProps<typeof PageHeader>, "tabs"> & {
  /** Abas da própria página — normalmente `<TabsList variant="segmented">`. */
  tabs?: ReactNode;
};

export function MasterPageHeader({ actions, tabs, className, ...props }: MasterPageHeaderProps) {
  const { masterUser, isOutbounder } = useMasterAuth();

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <PageHeader
        {...props}
        actions={
          <>
            {/* Vermelho tintado com texto forte: o selo branco sobre o
                vermelho cheio dava 3,8:1 e reprovava AA a 12 px. */}
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-destructive/10 px-3 text-xs font-bold text-destructive">
              <Shield className="h-3.5 w-3.5" aria-hidden />
              {isOutbounder ? "Painel outbound" : "Modo master"}
            </span>
            {actions}
          </>
        }
        tabs={<MasterGroupTabs />}
      />

      <MasterSubNav />

      {/* Faixa vermelha: o que se faz aqui atravessa organizações. */}
      <p
        role="note"
        className="flex items-start gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-[12.5px] font-semibold text-destructive"
      >
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          Camada master · o que você fizer aqui vale para todas as organizações e fica na auditoria.
        </span>
        {masterUser?.notes && (
          <span className="shrink-0 font-medium max-sm:hidden">Logado como {masterUser.notes}</span>
        )}
      </p>

      {tabs && <div className="flex min-w-0 max-w-full">{tabs}</div>}
    </div>
  );
}
