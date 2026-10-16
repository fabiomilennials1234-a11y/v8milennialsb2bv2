import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { useCanDo, useOrganization, useResponsibleMembers } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";
import { ClientPortfolioSection } from "../components/client-portfolio/ClientPortfolioSection";
import { LeadCardNewDeal } from "../components/lead-card/LeadCardNewDeal";
import { LeadCardPanel } from "../components/lead-card/LeadCardPanel";
import { LeadPanelProvider, useLeadSheet } from "../components/lead-detail";
import { DealPanelProvider } from "../components/deal-detail/DealPanelProvider";
import { DealCardPanel } from "../components/deal-card/DealCardPanel";
import { useDealSheet } from "../components/deal-detail/deal-sheet-context";
import { QUALIFICATION_TIER_CONFIG } from "../components/lead-detail/modal/qualification-config";
import { QUALIFICATION_TIERS } from "../components/lead-detail/modal/types";
import { useClassificacaoCafeJurere } from "../hooks/useClassificacaoCafeJurere";
import { useOrgUsaLeiDoErp } from "../hooks/useOrgUsaLeiDoErp";
import type { LeadsFilterParams } from "../hooks/useLeads";
import { LEAD_LIST_ORIGIN_LABELS } from "../lib/lead-list-origins";
import {
  CARTEIRA_PERSIST_KEY,
  CLASSIFICACAO_DA_CARTEIRA,
  DEFAULT_CARTEIRA_FILTERS,
  type CarteiraFilterState,
} from "../lib/carteira-route";

/**
 * Carteira — quem já compra e quando volta a comprar.
 *
 * Era a aba "Clientes" de `/leads`; virou página própria em `/carteira`
 * (decisão CTO 2026-10-16). O conteúdo é o mesmo `ClientPortfolioSection` —
 * segmentos, recompra, paginação no servidor, painel 360 e "Novo negócio" —
 * só mudou de endereço. O redirect da aba antiga mora em
 * `../hooks/useRedirecionaAbaClientes` (usado por `Leads.tsx`).
 *
 * Os filtros têm estado próprio (`usePersistedState("carteira")`), separado
 * do da lista de Leads: são telas diferentes agora, e filtrar uma não pode
 * recortar a outra em silêncio.
 */
function CarteiraInner() {
  const { openLead } = useLeadSheet();
  const { openDeal } = useDealSheet();
  const [newDealLeadId, setNewDealLeadId] = useState<string | null>(null);
  const [filterState, setFilterState] = usePersistedState<CarteiraFilterState>(
    CARTEIRA_PERSIST_KEY,
    DEFAULT_CARTEIRA_FILTERS,
  );
  const { searchQuery, filterOrigin, filterQualification, filterResponsible } = filterState;
  const usaCadastroErpCafeJurere = useClassificacaoCafeJurere();
  // Fonte da verdade sobre "é cliente?": cadastro no ERP para quem tem a
  // integração, a lei da Relação para o resto — a mesma da aba de Leads.
  const { usaLeiDoErp } = useOrgUsaLeiDoErp();
  const { allowed: canCreate } = useCanDo("create_lead");
  const responsibleMembers = useResponsibleMembers();
  const { organizationId } = useOrganization();

  useEffect(() => { setNewDealLeadId(null); }, [organizationId]);
  useEffect(() => { trackModuleVisit("carteira", organizationId); }, [organizationId]);

  // Deep-link `?lead=<id>` — inclusive o que chega redirecionado de `/leads`.
  const [searchParams] = useSearchParams();
  const deepLinkLeadId = searchParams.get("lead");
  useEffect(() => {
    if (deepLinkLeadId) openLead(deepLinkLeadId);
  }, [deepLinkLeadId, openLead]);

  const setFilter = useCallback(
    (key: keyof CarteiraFilterState) => (value: string) =>
      setFilterState((f) => ({ ...f, [key]: value })),
    [setFilterState],
  );
  const setSearchQuery = useMemo(() => setFilter("searchQuery"), [setFilter]);
  const setFilterOrigin = useMemo(() => setFilter("filterOrigin"), [setFilter]);
  const setFilterQualification = useMemo(() => setFilter("filterQualification"), [setFilter]);
  const setFilterResponsible = useMemo(() => setFilter("filterResponsible"), [setFilter]);

  const filters: LeadsFilterParams = {
    searchQuery,
    filterOrigin,
    filterQualification,
    filterClassificacao: CLASSIFICACAO_DA_CARTEIRA,
    usaLeiDoErp,
    usaCadastroErpCafeJurere,
    filterResponsible,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Carteira" subtitle="Quem já compra — e quando volta a comprar." />
      <ClientPortfolioSection
        key={organizationId}
        filters={filters}
        onSearch={setSearchQuery}
        canCreate={canCreate}
        onNewDeal={setNewDealLeadId}
        onOpenLead={openLead}
        onOpenDeal={(deal) => openDeal(deal.id, deal.leadId)}
        filterControls={(clearPortfolio) => (
          <div className="flex flex-wrap gap-2">
            <Select value={filterOrigin} onValueChange={setFilterOrigin}>
              <SelectTrigger className="w-40" aria-label="Origem dos clientes"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                {Object.entries(LEAD_LIST_ORIGIN_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterQualification} onValueChange={setFilterQualification}>
              <SelectTrigger className="w-[13.5rem]" aria-label="Qualificação dos clientes"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as qualificações</SelectItem>
                <SelectItem value="none">Sem qualificação</SelectItem>
                {QUALIFICATION_TIERS.map((tier) => (
                  <SelectItem key={tier} value={tier}>{QUALIFICATION_TIER_CONFIG[tier].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterResponsible} onValueChange={setFilterResponsible}>
              <SelectTrigger className="w-48" aria-label="Dono da conta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os donos</SelectItem>
                <SelectItem value="none">Sem dono</SelectItem>
                {responsibleMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                clearPortfolio();
                setFilterState(DEFAULT_CARTEIRA_FILTERS);
              }}
            >
              Limpar filtros
            </Button>
          </div>
        )}
      />
      {newDealLeadId && (
        <LeadCardNewDeal
          leadId={newDealLeadId}
          open
          onOpenChange={(open) => { if (!open) setNewDealLeadId(null); }}
        />
      )}
    </div>
  );
}

/**
 * Mesma moldura de painéis de `/leads`: o Card do Lead e o Card do Negócio
 * abrem por cima da carteira, como abriam dentro da aba.
 */
export default function Carteira() {
  return (
    <LeadPanelProvider>
      <DealPanelProvider>
        <LeadPanelLayout
          panel={
            <>
              <DealCardPanel />
              <LeadCardPanel />
            </>
          }
        >
          <CarteiraInner />
        </LeadPanelLayout>
      </DealPanelProvider>
    </LeadPanelProvider>
  );
}
