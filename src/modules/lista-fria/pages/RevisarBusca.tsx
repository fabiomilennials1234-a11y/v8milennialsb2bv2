/**
 * Lista Fria · Revisar busca (mockups 5 e 6 do board Miro).
 *
 * O cliente confere o que a busca achou, desmarca o que não quer e importa para
 * a aba Lista fria da tela de Leads. Importar cria LEAD sem funil e sem card.
 * Sem disparo: a lista só exporta e importa (decisão do CTO, 27/10).
 */
import { CheckCircle2, FileDown, Loader2, Megaphone, Search, ShieldCheck, Snowflake, UserX, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { KpiRow, KpiTile } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/shared/components/EmptyState";
import { FilterChip } from "@/shared/components/FilterChip";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { DivisaoDosContatosPainel } from "../components/DivisaoDosContatos";
import { useExportarBusca, useExportarPublicoMeta } from "../hooks/useExportarBusca";
import { useListaFriaAcesso } from "../hooks/useListaFriaAcesso";
import {
  FILTROS_DA_REVISAO,
  TAMANHO_DA_PAGINA,
  type FiltrosDaRevisao,
  useBusca,
  useDivisaoDosContatos,
  usePendentesDaImportacao,
  useResultados,
} from "../hooks/useListaFriaDados";
import { useImportarBusca, useSelecionarPorContato, useSelecionarResultados } from "../hooks/useListaFriaMutacoes";
import { recusaDaListaFria } from "../lib/erros";
import { ROTULO_FONTE, ROTULO_QUALIDADE, type QualidadeDoContato, buscaEstaAberta, buscaTemResultado, fraseDosCriterios } from "../lib/tipos";

const COR_DA_QUALIDADE: Record<QualidadeDoContato, string> = {
  verificado: "text-success-strong",
  sem_whatsapp: "text-warning-strong",
  email_invalido: "text-destructive-strong",
  nao_verificado: "text-muted-foreground",
};

const n = (v: number) => v.toLocaleString("pt-BR");

export default function RevisarBusca() {
  const { buscaId } = useParams<{ buscaId: string }>();
  const navigate = useNavigate();
  const { podeEditar } = useListaFriaAcesso();
  const [filtros, setFiltros] = useState<FiltrosDaRevisao>(FILTROS_DA_REVISAO);
  const [confirmando, setConfirmando] = useState(false);

  const { data: busca, isLoading: carregandoBusca } = useBusca(buscaId);
  const { data: resultados, isFetching } = useResultados(buscaId, filtros);
  const { data: pendentes } = usePendentesDaImportacao(buscaId);
  const criterios = { comInstagram: filtros.comInstagram, comTelefone: filtros.comTelefone, comEmail: filtros.comEmail };
  const { data: divisao } = useDivisaoDosContatos(buscaId, criterios);
  const selecionar = useSelecionarResultados();
  const selecionarPorContato = useSelecionarPorContato();
  const importar = useImportarBusca();
  const exportar = useExportarBusca();
  const exportarMeta = useExportarPublicoMeta();

  const mudar = (parcial: Partial<FiltrosDaRevisao>) => setFiltros((f) => ({ ...f, pagina: 0, ...parcial }));

  if (carregandoBusca) {
    return (
      <div className="grid h-[50vh] place-items-center text-muted-foreground" role="status" aria-label="Carregando">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!busca) {
    return (
      <EmptyState
        icon={Snowflake}
        title="Busca não encontrada"
        description="Ela pode ter sido removida, ou não é da sua organização."
        action={<Button onClick={() => navigate("/leads")}>Voltar para Leads</Button>}
      />
    );
  }

  const linhas = resultados?.linhas ?? [];
  const total = resultados?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAMANHO_DA_PAGINA));
  const selecionados = pendentes?.selecionados ?? 0;
  const novos = pendentes?.novos ?? 0;
  const todosMarcados = novos > 0 && selecionados === novos;
  const naoTerminou = buscaEstaAberta(busca);
  // A coluna @ só existe quando algum resultado tem @ (busca de Instagram): em Maps e CNPJ seria uma coluna vazia.
  const mostrarArroba = (divisao?.comInstagram ?? 0) > 0;
  const podeImportar = podeEditar && buscaTemResultado(busca) && selecionados > 0 && !importar.isPending;

  const erroDeEscrita = (fallback: string) => (err: unknown) =>
    notifyError(err, {
      fallback,
      message: recusaDaListaFria(err as { code?: string; message?: string }),
      context: { feature: "lista-fria" },
    });

  const marcar = (ids: string[] | null, marcado: boolean) =>
    selecionar.mutate(
      { buscaId: busca.id, ids, selecionado: marcado },
      { onError: erroDeEscrita("Não foi possível atualizar a seleção.") },
    );

  const selecionarSoEstes = () =>
    selecionarPorContato.mutate(
      { buscaId: busca.id, criterios },
      {
        onSuccess: (qtd) =>
          toast.success(
            fraseDosCriterios(criterios)
              ? `${n(qtd)} contatos com ${fraseDosCriterios(criterios)} selecionados para importar.`
              : `${n(qtd)} contatos selecionados para importar.`,
          ),
        onError: erroDeEscrita("Não foi possível atualizar a seleção."),
      },
    );

  const confirmarImportacao = () =>
    importar.mutate(busca.id, {
      onSuccess: (r) => {
        setConfirmando(false);
        toast.success(`${n(r.importados)} contatos importados. Estão na aba Lista fria, sem funil.`);
        navigate("/leads?aba=lista_fria");
      },
      onError: (err) => {
        setConfirmando(false);
        erroDeEscrita("A importação parou no meio. O que já entrou ficou na Lista fria.")(err);
      },
    });

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        back="/leads?aba=lista_fria"
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Snowflake className="size-3" aria-hidden /> Lista fria
          </span>
        }
        title="Revisar busca"
        subtitle={`${ROTULO_FONTE[busca.fonte]} · ${busca.titulo} · ${n(busca.creditosUsados)} créditos usados`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                exportarMeta.mutate(busca, {
                  onSuccess: ({ linhas, descartados }) => {
                    if (linhas === 0) {
                      toast.info("Nenhum contato com e-mail ou telefone aproveitável para o Meta.");
                      return;
                    }
                    const fora = descartados > 0 ? ` ${n(descartados)} ficaram de fora (sem contato aproveitável ou repetidos).` : "";
                    toast.success(
                      `${n(linhas)} contatos no arquivo. No Meta: Públicos → Criar → Público personalizado → Lista de clientes.${fora}`,
                    );
                  },
                  onError: erroDeEscrita("Não foi possível gerar o arquivo do Meta."),
                })
              }
              disabled={exportarMeta.isPending || busca.contatosNovos + busca.jaLeads === 0}
            >
              {exportarMeta.isPending ? <Loader2 className="animate-spin" /> : <Megaphone />}
              Público do Meta
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                exportar.mutate(
                  { buscaId: busca.id, titulo: busca.titulo },
                  {
                    onSuccess: (qtd) => toast.success(`${n(qtd)} contatos exportados.`),
                    onError: erroDeEscrita("Não foi possível exportar."),
                  },
                )
              }
              disabled={exportar.isPending || busca.contatosNovos + busca.jaLeads === 0}
            >
              {exportar.isPending ? <Loader2 className="animate-spin" /> : <FileDown />}
              Exportar CSV
            </Button>
          </div>
        }
      />

      {naoTerminou && (
        <p className="rounded-2xl border border-card-border bg-card px-4 py-3 text-[13px] text-muted-foreground shadow-relevo">
          A busca ainda está rodando. O que já foi achado aparece abaixo, mas a importação só abre quando ela terminar.
        </p>
      )}

      <KpiRow cols={4}>
        <KpiTile label="Negócios encontrados" value={n(busca.encontrados)} icon={Search} tone="info" />
        <KpiTile
          label="Contatos novos e válidos"
          value={n(busca.contatosNovos)}
          icon={ShieldCheck}
          tone="good"
          note={
            busca.cobranca === "por_varredura"
              ? `${n(busca.varridos)} seguidores analisados · ${n(busca.creditosUsados)} créditos Meta`
              : `${n(busca.creditosUsados)} créditos usados`
          }
        />
        <KpiTile label="Já são leads" value={n(busca.jaLeads)} icon={Users} note="não cobrados, sem duplicar" />
        <KpiTile label="Sem contato" value={n(busca.semContato)} icon={UserX} note="não cobrados" />
      </KpiRow>

      <DivisaoDosContatosPainel
        divisao={divisao}
        criterios={criterios}
        onCriterios={(c) => mudar(c)}
        onSelecionar={selecionarSoEstes}
        selecionando={selecionarPorContato.isPending}
        podeEditar={podeEditar && buscaTemResultado(busca)}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-[360px]">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar nesta busca…"
            value={filtros.busca}
            onChange={(e) => mudar({ busca: e.target.value })}
            className="h-[38px] rounded-full pl-10 shadow-relevo"
            aria-label="Buscar nesta busca"
          />
        </div>
        <FilterChip active={filtros.somenteNovos} count={n(novos)} aria-pressed={filtros.somenteNovos} onClick={() => mudar({ somenteNovos: !filtros.somenteNovos })}>
          Só novos
        </FilterChip>
        <FilterChip active={filtros.verificados} aria-pressed={filtros.verificados} onClick={() => mudar({ verificados: !filtros.verificados })}>
          Verificados
        </FilterChip>
      </div>

      <div className={cn("overflow-hidden rounded-[22px] border border-card-border bg-card shadow-relevo", isFetching && "opacity-80")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={todosMarcados ? true : selecionados > 0 ? "indeterminate" : false}
                  onCheckedChange={() => marcar(null, !todosMarcados)}
                  disabled={!podeEditar || novos === 0 || selecionar.isPending}
                  aria-label="Marcar todos os novos"
                />
              </TableHead>
              <TableHead>Negócio</TableHead>
              {mostrarArroba && <TableHead>@</TableHead>}
              <TableHead>Telefone</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Qualidade</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={mostrarArroba ? 7 : 6} className="py-12 text-center text-[13px] text-muted-foreground">
                  {isFetching ? "Carregando…" : "Nenhum contato neste recorte."}
                </TableCell>
              </TableRow>
            ) : (
              linhas.map((r) => {
                const travada = r.jaELead || r.importado;
                return (
                  <TableRow key={r.id} className={cn(travada && "opacity-55")}>
                    <TableCell>
                      <Checkbox
                        checked={!travada && r.selecionado}
                        disabled={travada || !podeEditar || selecionar.isPending}
                        onCheckedChange={(v) => marcar([r.id], v === true)}
                        aria-label={`Importar ${r.nome}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate font-bold">{r.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">{[r.categoria, r.bairro].filter(Boolean).join(" · ")}</p>
                    </TableCell>
                    {mostrarArroba && (
                      <TableCell className="max-w-[180px] truncate">{r.instagram ? `@${r.instagram}` : <span className="text-muted-foreground">·</span>}</TableCell>
                    )}
                    <TableCell className="whitespace-nowrap tabular-nums">{r.telefone ?? <span className="text-muted-foreground">·</span>}</TableCell>
                    <TableCell className="max-w-[260px] truncate">{r.email ?? <span className="text-muted-foreground">·</span>}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", COR_DA_QUALIDADE[r.qualidade])}>
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                        {ROTULO_QUALIDADE[r.qualidade]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex h-[22px] items-center rounded-full px-2.5 text-[11px] font-bold",
                          r.importado || r.jaELead ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary-soft-foreground",
                        )}
                      >
                        {r.jaELead ? "Já é lead" : r.importado ? "Importado" : "Novo"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {paginas > 1 && (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {n(total)} contatos · página {filtros.pagina + 1} de {paginas}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" disabled={filtros.pagina === 0} onClick={() => setFiltros((f) => ({ ...f, pagina: f.pagina - 1 }))}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={filtros.pagina + 1 >= paginas} onClick={() => setFiltros((f) => ({ ...f, pagina: f.pagina + 1 }))}>
                Próxima
              </Button>
            </span>
          </footer>
        )}
      </div>

      <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-5xl items-center justify-between gap-3 rounded-[20px] border border-card-border bg-elevated px-5 py-3.5 shadow-relevo-alto sm:left-[calc(var(--sidebar-width,4.25rem)+1rem)]">
        <p className="text-sm">
          <b className="tabular-nums">{n(selecionados)} contatos selecionados</b>
          {busca.jaLeads > 0 && <span className="ml-2 text-xs text-muted-foreground">Os {n(busca.jaLeads)} que já são leads ficam de fora.</span>}
        </p>
        <Button onClick={() => setConfirmando(true)} disabled={!podeImportar}>
          <CheckCircle2 />
          Importar para Lista fria
        </Button>
      </div>

      <Dialog open={confirmando} onOpenChange={(v) => !importar.isPending && setConfirmando(v)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Importar {n(selecionados)} contatos?</DialogTitle>
            <DialogDescription>Eles entram na tela de Leads, na aba Lista fria.</DialogDescription>
          </DialogHeader>
          {divisao && (
            <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm" data-testid="divisao-da-importacao">
              Destes, <b className="tabular-nums">{n(divisao.selecionadosComInstagram)}</b> têm @,{" "}
              <b className="tabular-nums">{n(divisao.selecionadosComTelefone)}</b> têm telefone e{" "}
              <b className="tabular-nums">{n(divisao.selecionadosComEmail)}</b> têm e-mail.
            </p>
          )}
          <ul className="space-y-4 text-sm">
            <li className="flex gap-3">
              <Snowflake className="mt-0.5 size-5 shrink-0 text-primary-soft-foreground" aria-hidden />
              <span>
                <b>Seção própria.</b> <span className="text-muted-foreground">Ficam separados dos seus leads, na aba Lista fria. Nada se mistura com a sua base atual.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary-soft-foreground" aria-hidden />
              <span>
                <b>Sem funil, sem card, sem disparo.</b> <span className="text-muted-foreground">Nenhum funil é atribuído e nenhuma automação sai para eles.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <Users className="mt-0.5 size-5 shrink-0 text-primary-soft-foreground" aria-hidden />
              <span>
                <b>Sem duplicar.</b> <span className="text-muted-foreground">{n(busca.jaLeads)} negócios já são leads e ficam de fora.</span>
              </span>
            </li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={importar.isPending}>
              Voltar
            </Button>
            <Button onClick={confirmarImportacao} disabled={importar.isPending}>
              {importar.isPending ? <Loader2 className="animate-spin" /> : null}
              Importar {n(selecionados)} contatos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
