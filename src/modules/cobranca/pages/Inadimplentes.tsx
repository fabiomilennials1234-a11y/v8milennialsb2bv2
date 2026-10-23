/**
 * Cobrança · Inadimplentes — a lista da área (ADR-0040).
 *
 * Mesma estrutura da tela de Leads: cabeçalho, quatro números que também são
 * filtros, linha de chips, tabela e barra de lote. Cada linha é um devedor com
 * o saldo somado dos títulos em aberto; clicar abre a ficha na gaveta.
 */
import { FileUp, Plus, Search, Wallet, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { useTeamMembers } from "@/modules/identity";
import { EmptyState } from "@/shared/components/EmptyState";
import { FilterChip } from "@/shared/components/FilterChip";
import { cn } from "@/lib/utils";

import { FAIXAS_DE_ATRASO, type FaixaDeAtraso } from "../lib/atraso";
import { ROTULO_ORIGEM } from "../lib/formato";
import type { InadimplenteResumo, Origem } from "../lib/tipos";
import {
  FILTROS_PADRAO,
  TAMANHO_DA_PAGINA,
  type FiltrosDeInadimplentes,
  useEtapas,
  useInadimplentes,
  useMetricas,
} from "../hooks/useCobrancaDados";
import { useCobrancaAcesso } from "../hooks/useCobrancaAcesso";
import { BarraDeLote } from "../components/BarraDeLote";
import { CobrancaTabs } from "../components/CobrancaTabs";
import { ContatoDialog, InadimplenteDialog, PagamentoDialog } from "../components/dialogos";
import { ImportarPlanilhaDialog } from "../components/ImportarPlanilhaDialog";
import { InadimplenteGaveta } from "../components/InadimplenteGaveta";
import { InadimplentesTabela } from "../components/InadimplentesTabela";
import { MetricasInadimplentes } from "../components/MetricasInadimplentes";

export default function Inadimplentes() {
  const { podeEditar } = useCobrancaAcesso();
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosDeInadimplentes>(FILTROS_PADRAO);
  const [buscaFocada, setBuscaFocada] = useState(false);
  const [selecionados, setSelecionados] = useState<Map<string, InadimplenteResumo>>(new Map());
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [rapido, setRapido] = useState<null | { tipo: "contato" | "pagamento"; r: InadimplenteResumo }>(null);

  const { data: etapas = [] } = useEtapas();
  const { data: metricas, isLoading: carregandoMetricas } = useMetricas();
  const { data, isLoading, isFetching } = useInadimplentes(filtros);
  const { data: membros = [] } = useTeamMembers();

  // A ficha aberta mora na URL: link compartilhável e o "voltar" fecha a gaveta.
  const aberto = params.get("inadimplente");
  const abrir = (r: InadimplenteResumo) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("inadimplente", r.id);
      return n;
    });
  const fecharFicha = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("inadimplente");
      return n;
    }, { replace: true });

  const muda = (parcial: Partial<FiltrosDeInadimplentes>) => setFiltros((f) => ({ ...f, ...parcial, pagina: 0 }));
  const linhas = data?.linhas ?? [];
  const total = data?.total ?? 0;
  const etapasAbertas = etapas.filter((e) => e.papel === "aberta");
  const membrosAtivos = membros.filter((m) => m.is_active !== false && m.id);
  const filtrado =
    !!filtros.busca || !!filtros.faixa || !!filtros.etapaId || !!filtros.responsavel || !!filtros.origem ||
    filtros.comCompromisso || filtros.semContato || filtros.situacao !== "em_aberto";

  const alternarSelecao = (r: InadimplenteResumo) =>
    setSelecionados((s) => {
      const n = new Map(s);
      if (r.casoId && n.has(r.casoId)) n.delete(r.casoId);
      else if (r.casoId) n.set(r.casoId, r);
      return n;
    });

  const vazio = useMemo(
    () =>
      filtrado ? (
        <EmptyState icon={Search} title="Nada com esses filtros" description="Tire um filtro ou busque por outro nome, CPF/CNPJ ou telefone." />
      ) : (
        <EmptyState
          icon={Wallet}
          title="Nenhum inadimplente em aberto"
          description="Cadastre um devedor à mão ou importe uma planilha. Com ERP conectado, os títulos vencidos entram sozinhos."
          action={
            podeEditar ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setImportando(true)}>
                  <FileUp />
                  Importar planilha
                </Button>
                <Button onClick={() => setNovo(true)}>
                  <Plus />
                  Novo inadimplente
                </Button>
              </div>
            ) : undefined
          }
        />
      ),
    [filtrado, podeEditar],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Cobrança"
        title="Inadimplentes"
        subtitle="Quem deve, quanto e desde quando. Entram por cadastro manual, planilha ou ERP."
        secondaryActions={podeEditar ? [{ label: "Importar", icon: FileUp, onSelect: () => setImportando(true) }] : undefined}
        secondaryActionsLabel="Mais ações de inadimplentes"
        actions={
          podeEditar ? (
            <Button onClick={() => setNovo(true)}>
              <Plus />
              Novo inadimplente
            </Button>
          ) : undefined
        }
        tabs={<CobrancaTabs ativa="inadimplentes" abertos={metricas?.casosAbertos} />}
      />

      <MetricasInadimplentes
        m={metricas}
        carregando={carregandoMetricas}
        semContatoAtivo={filtros.semContato}
        onSemContato={() => muda({ semContato: !filtros.semContato })}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div
          className={cn(
            "relative w-full transition-[max-width] duration-300 ease-standard",
            buscaFocada ? "sm:max-w-xl" : "sm:max-w-[360px]",
          )}
        >
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail…"
            value={filtros.busca}
            onChange={(e) => muda({ busca: e.target.value })}
            onFocus={() => setBuscaFocada(true)}
            onBlur={() => setBuscaFocada(false)}
            className="h-[38px] rounded-full pl-10 shadow-relevo"
            aria-label="Buscar inadimplente"
          />
        </div>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:contents">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip caret active={!!filtros.faixa}>
                {filtros.faixa ? `Atraso: ${FAIXAS_DE_ATRASO.find((f) => f.faixa === filtros.faixa)?.rotulo}` : "Atraso"}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuRadioGroup value={filtros.faixa ?? "todas"} onValueChange={(v) => muda({ faixa: v === "todas" ? null : (v as FaixaDeAtraso) })}>
                <DropdownMenuRadioItem value="todas">Qualquer atraso</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {FAIXAS_DE_ATRASO.map((f) => (
                  <DropdownMenuRadioItem key={f.faixa} value={f.faixa}>
                    {f.rotulo}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip caret active={!!filtros.etapaId} swatch={etapas.find((e) => e.id === filtros.etapaId)?.cor}>
                {filtros.etapaId ? `Etapa: ${etapas.find((e) => e.id === filtros.etapaId)?.nome ?? ""}` : "Etapa no fluxo"}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup value={filtros.etapaId ?? "todas"} onValueChange={(v) => muda({ etapaId: v === "todas" ? null : v })}>
                <DropdownMenuRadioItem value="todas">Todas as etapas</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {etapasAbertas.map((e) => (
                  <DropdownMenuRadioItem key={e.id} value={e.id}>
                    <span aria-hidden className="mr-2 size-2 rounded-full" style={{ background: e.cor }} />
                    {e.nome}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip caret active={!!filtros.responsavel}>
                {filtros.responsavel === "sem"
                  ? "Sem responsável"
                  : filtros.responsavel
                    ? `Responsável: ${membrosAtivos.find((m) => m.id === filtros.responsavel)?.name ?? ""}`
                    : "Responsável"}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={filtros.responsavel ?? "todos"} onValueChange={(v) => muda({ responsavel: v === "todos" ? null : v })}>
                <DropdownMenuRadioItem value="todos">Todos</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="sem">Sem responsável</DropdownMenuRadioItem>
                {membrosAtivos.length > 0 && <DropdownMenuSeparator />}
                {membrosAtivos.map((m) => (
                  <DropdownMenuRadioItem key={m.id} value={m.id}>
                    {m.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip caret active={!!filtros.origem}>
                {filtros.origem ? `Origem: ${ROTULO_ORIGEM[filtros.origem]}` : "Origem"}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuRadioGroup value={filtros.origem ?? "todas"} onValueChange={(v) => muda({ origem: v === "todas" ? null : (v as Origem) })}>
                <DropdownMenuRadioItem value="todas">Todas as origens</DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                <DropdownMenuRadioItem value="manual">Cadastro manual</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="planilha">Planilha</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="erp">ERP</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <FilterChip active={filtros.comCompromisso} onClick={() => muda({ comCompromisso: !filtros.comCompromisso })}>
            Com promessa ou acordo
          </FilterChip>

          <FilterChip
            active={filtros.situacao === "todos"}
            onClick={() => muda({ situacao: filtros.situacao === "todos" ? "em_aberto" : "todos" })}
            title="Inclui quem já pagou, foi baixado ou cancelado"
          >
            Incluir encerrados
          </FilterChip>

          <span className="hidden flex-1 sm:block" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip caret>
                {{ atraso: "Mais antigos primeiro", saldo: "Maior saldo primeiro", recentes: "Cadastrados por último" }[filtros.ordem]}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuRadioGroup value={filtros.ordem} onValueChange={(v) => muda({ ordem: v as FiltrosDeInadimplentes["ordem"] })}>
                <DropdownMenuRadioItem value="atraso">Mais antigos primeiro</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="saldo">Maior saldo primeiro</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="recentes">Cadastrados por último</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {filtrado && (
        <div className="-mt-2 flex">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setFiltros(FILTROS_PADRAO)}>
            <X />
            Limpar filtros
          </Button>
        </div>
      )}

      <div className={cn("transition-opacity", isFetching && !isLoading && "opacity-70")}>
        <InadimplentesTabela
          linhas={linhas}
          total={total}
          pagina={filtros.pagina}
          tamanhoDaPagina={TAMANHO_DA_PAGINA}
          onPagina={(p) => setFiltros((f) => ({ ...f, pagina: p }))}
          selecionados={new Set(selecionados.keys())}
          onSelecionar={(casoId) => {
            const r = linhas.find((l) => l.casoId === casoId);
            if (r) alternarSelecao(r);
          }}
          onSelecionarPagina={(marcar) =>
            setSelecionados((s) => {
              const n = new Map(s);
              for (const r of linhas) {
                if (!r.casoId) continue;
                if (marcar) n.set(r.casoId, r);
                else n.delete(r.casoId);
              }
              return n;
            })
          }
          acoes={{
            onAbrir: abrir,
            onContato: (r) => setRapido({ tipo: "contato", r }),
            onPagamento: (r) => setRapido({ tipo: "pagamento", r }),
          }}
          podeEditar={podeEditar}
          carregando={isLoading}
          vazio={vazio}
        />
      </div>

      {podeEditar && (
        <BarraDeLote selecionados={[...selecionados.values()]} etapas={etapas} onLimpar={() => setSelecionados(new Map())} />
      )}

      <InadimplenteGaveta inadimplenteId={aberto} onFechar={fecharFicha} etapas={etapas} podeEditar={podeEditar} />
      <InadimplenteDialog
        aberto={novo}
        onFechar={() => setNovo(false)}
        onSalvo={(id) => abrir({ id } as InadimplenteResumo)}
      />
      <ImportarPlanilhaDialog aberto={importando} onFechar={() => setImportando(false)} />
      {rapido?.tipo === "contato" && <ContatoDialog aberto onFechar={() => setRapido(null)} caso={rapido.r} />}
      {rapido?.tipo === "pagamento" && <PagamentoDialog aberto onFechar={() => setRapido(null)} caso={rapido.r} />}
    </div>
  );
}
