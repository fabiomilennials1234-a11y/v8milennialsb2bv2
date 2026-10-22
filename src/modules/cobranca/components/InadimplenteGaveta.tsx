/**
 * A ficha do inadimplente — mesma gaveta do lead (560 px, raio 28), conteúdo
 * da cobrança: situação, compromisso ativo, títulos e histórico do caso.
 *
 * Tudo o que se faz aqui é registro: promessa, acordo, pagamento, contato. O
 * Torque não negocia (decisão do CTO, 21/10) — guarda o que a equipe combinou.
 */
import {
  Archive,
  BellOff,
  CalendarClock,
  Copy,
  Handshake,
  History,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Scale,
  StickyNote,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useTeamMembers } from "@/modules/identity";
import { GavetaLateral } from "@/shared/components/GavetaLateral";
import { notifyError } from "@/shared/errors";
import { useViewport } from "@/shared/hooks/use-viewport";
import { cn } from "@/lib/utils";

import { atrasoDe, diaCurto, haQuantoTempo } from "../lib/atraso";
import { formatarDocumento, formatarTelefone } from "../lib/documento";
import { recusaDaCobranca } from "../lib/erros";
import { ROTULO_CANAL, ROTULO_DESFECHO, ROTULO_ORIGEM, ROTULO_RESULTADO, plural, reais } from "../lib/formato";
import type { CanalDeContato, Etapa, EventoDoCaso, ResultadoDoContato, TipoDeCompromisso } from "../lib/tipos";
import { useFichaDoInadimplente, type FichaDoInadimplente } from "../hooks/useCobrancaDados";
import {
  useArquivarInadimplente,
  useCancelarTitulo,
  useEncerrarCompromisso,
  useNaoContatar,
} from "../hooks/useCobrancaMutacoes";
import { AtrasoSelo, EtapaPill, IniciaisAvatar } from "./atomos";
import {
  CompromissoDialog,
  ConfirmarDialog,
  ContatoDialog,
  InadimplenteDialog,
  PagamentoDialog,
  TituloDialog,
} from "./dialogos";

type Secao = "resumo" | "titulos" | "historico";

export function InadimplenteGaveta({
  inadimplenteId,
  onFechar,
  etapas,
  podeEditar,
}: {
  inadimplenteId: string | null;
  onFechar: () => void;
  etapas: Etapa[];
  podeEditar: boolean;
}) {
  const { isMobile } = useViewport();
  const { data: ficha, isLoading } = useFichaDoInadimplente(inadimplenteId);

  return (
    <GavetaLateral aberta={!!inadimplenteId} onFechar={onFechar} celular={isMobile} rotulo="Ficha do inadimplente">
      {isLoading || !ficha ? (
        <div className="grid h-full place-items-center text-muted-foreground">
          {isLoading ? <Loader2 className="size-5 animate-spin" /> : "Inadimplente não encontrado."}
        </div>
      ) : (
        <ConteudoDaFicha key={ficha.resumo.id} ficha={ficha} onFechar={onFechar} etapas={etapas} podeEditar={podeEditar} />
      )}
    </GavetaLateral>
  );
}

function ConteudoDaFicha({
  ficha,
  onFechar,
  etapas,
  podeEditar,
}: {
  ficha: FichaDoInadimplente;
  onFechar: () => void;
  etapas: Etapa[];
  podeEditar: boolean;
}) {
  const r = ficha.resumo;
  const [secao, setSecao] = useState<Secao>("resumo");
  const [dialogo, setDialogo] = useState<
    | null
    | { tipo: "editar" }
    | { tipo: "titulo" }
    | { tipo: "compromisso"; inicial: TipoDeCompromisso }
    | { tipo: "pagamento" }
    | { tipo: "contato" }
    | { tipo: "arquivar" }
    | { tipo: "cancelar-titulo"; tituloId: string }
    | { tipo: "quebrar" }
  >(null);
  const naoContatar = useNaoContatar();
  const arquivar = useArquivarInadimplente();
  const cancelarTitulo = useCancelarTitulo();
  const encerrar = useEncerrarCompromisso();
  const fechar = () => setDialogo(null);
  const temCaso = !!r.casoId;
  const maiorAtraso = atrasoDe(r.vencimentoMaisAntigo);
  const falha = (fallback: string) => (err: unknown) =>
    notifyError(err, { fallback, message: recusaDaCobranca(err as { code?: string; message?: string }), context: { feature: "cobranca" } });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* topo */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          <Wallet className="size-3" aria-hidden />
          Inadimplente · {ROTULO_ORIGEM[r.origem]}
        </span>
        {/* `mr-10`: o canto é do fechar da própria gaveta (o X do DialogContent/SheetContent, como na ficha do lead). */}
        <div className="mr-10 flex items-center gap-1">
          {podeEditar && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" aria-label="Mais ações">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setDialogo({ tipo: "editar" })}>
                  <Pencil className="mr-2 size-3.5" /> Editar dados
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialogo({ tipo: "titulo" })}>
                  <Plus className="mr-2 size-3.5" /> Incluir título
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => setDialogo({ tipo: "arquivar" })}>
                  <Archive className="mr-2 size-3.5" /> Arquivar (lançado por engano)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
        {/* cabeçalho */}
        <div className="flex items-center gap-3.5 pt-1">
          <IniciaisAvatar nome={r.nome} tamanho="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-[-0.02em]">{r.nome}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {[r.documento ? formatarDocumento(r.documento) : null, r.cidade, r.contatoNome ? `contato: ${r.contatoNome}` : null]
                .filter(Boolean)
                .join(" · ") || "Sem documento"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {r.saldoAberto > 0 ? (
                <span className="inline-flex h-6 items-center rounded-full bg-destructive/10 px-2.5 text-[11.5px] font-bold text-destructive">
                  Deve {reais(r.saldoAberto)}
                </span>
              ) : (
                <span className="inline-flex h-6 items-center rounded-full bg-success/10 px-2.5 text-[11.5px] font-bold text-success-strong">
                  {r.ultimoDesfecho ? ROTULO_DESFECHO[r.ultimoDesfecho] : "Sem saldo em aberto"}
                </span>
              )}
              {r.etapaNome && <EtapaPill nome={`${r.etapaNome}${r.etapaDesde ? ` · ${haQuantoTempo(r.etapaDesde)}` : ""}`} cor={r.etapaCor} />}
              {r.responsavelNome && (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11.5px] font-semibold">
                  <IniciaisAvatar nome={r.responsavelNome} tamanho="xs" />
                  {r.responsavelNome}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ações */}
        {podeEditar && temCaso && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AcaoBotao icone={CalendarClock} rotulo="Promessa" onClick={() => setDialogo({ tipo: "compromisso", inicial: "promessa" })} />
            <AcaoBotao icone={Handshake} rotulo="Acordo" onClick={() => setDialogo({ tipo: "compromisso", inicial: "acordo" })} />
            <AcaoBotao icone={Receipt} rotulo="Pagamento" onClick={() => setDialogo({ tipo: "pagamento" })} />
            <AcaoBotao icone={Phone} rotulo="Contato" onClick={() => setDialogo({ tipo: "contato" })} />
          </div>
        )}

        {/* contato e "não contatar" */}
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-sunken px-3.5 py-2.5">
          <MessageCircle className={cn("size-4 shrink-0", r.telefone ? "text-success-strong" : "text-muted-foreground/40")} aria-hidden />
          <div className="min-w-0 flex-1 text-[12.5px]">
            <p className="truncate font-semibold">{r.telefone ? formatarTelefone(r.telefone) : "Sem telefone"}</p>
            <p className="truncate text-muted-foreground">{r.email ?? "Sem e-mail"}</p>
          </div>
          {r.telefone && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Copiar telefone"
              onClick={() => {
                void navigator.clipboard?.writeText(formatarTelefone(r.telefone));
                toast.success("Telefone copiado.");
              }}
            >
              <Copy />
            </Button>
          )}
          <label className="flex shrink-0 items-center gap-2 text-[11.5px] font-semibold text-muted-foreground" title="O devedor pediu para não receber mensagens automáticas">
            <BellOff className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Não contatar</span>
            <Switch
              checked={r.naoContatar}
              disabled={!podeEditar || naoContatar.isPending}
              onCheckedChange={(v) =>
                naoContatar.mutate({ inadimplenteId: r.id, valor: v }, { onError: falha("Não foi possível alterar.") })
              }
              aria-label="Não contatar"
            />
          </label>
        </div>

        {/* seções */}
        <div className="grid grid-cols-3 rounded-full bg-muted p-1" role="tablist">
          {(
            [
              ["resumo", "Resumo", null],
              ["titulos", "Títulos", ficha.titulos.filter((t) => t.status === "aberto").length],
              ["historico", "Histórico", ficha.eventos.length],
            ] as [Secao, string, number | null][]
          ).map(([k, rotulo, n]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={secao === k}
              onClick={() => setSecao(k)}
              className={cn(
                "rounded-full py-1.5 text-[12.5px] font-bold text-muted-foreground transition-colors",
                secao === k && "bg-card text-foreground shadow-relevo",
              )}
            >
              {rotulo}
              {n != null && <span className="ml-1 font-semibold opacity-70">{n}</span>}
            </button>
          ))}
        </div>

        {secao === "resumo" && (
          <>
            <section className="rounded-[20px] bg-tinta p-3.5 text-tinta-foreground shadow-relevo-tinta">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-tinta-muted">
                <Scale className="size-3.5" aria-hidden /> Situação
              </h3>
              {/* Celular: o saldo ganha a linha inteira — em ⅓ de 390 px o valor cortava. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Pastilha
                  rotulo="Em aberto"
                  valor={r.saldoAberto > 0 ? reais(r.saldoAberto) : "R$ 0,00"}
                  destaque={r.saldoAberto > 0}
                  className="col-span-2 sm:col-span-1"
                />
                <Pastilha rotulo="Maior atraso" valor={maiorAtraso && maiorAtraso.dias > 0 ? plural(maiorAtraso.dias, "dia", "dias") : "—"} />
                <Pastilha rotulo="Títulos em aberto" valor={String(r.titulosAbertos)} />
              </div>
              <p className="mt-2.5 text-xs text-tinta-muted">
                {r.abertoEm ? `Caso aberto em ${diaCurto(r.abertoEm.slice(0, 10))}` : "Sem caso aberto"}
                {r.ultimoContatoEm ? ` · último contato ${haQuantoTempo(r.ultimoContatoEm)}` : " · nenhum contato registrado"}
              </p>
            </section>

            {ficha.compromisso && (
              <section className="rounded-[18px] border border-primary/25 bg-primary-soft/40 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-primary-soft-foreground">
                    <Handshake className="size-3.5" aria-hidden />
                    {ficha.compromisso.tipo === "promessa" ? "Promessa ativa" : `Acordo em ${ficha.compromisso.parcelas.length}x`}
                  </h3>
                  {podeEditar && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDialogo({ tipo: "quebrar" })}>
                      Marcar quebra
                    </Button>
                  )}
                </div>
                <ul className="space-y-1">
                  {ficha.compromisso.parcelas.map((p, _i, todas) => {
                    const a = atrasoDe(p.vencimento);
                    return (
                      <li key={p.numero} className="flex items-center justify-between text-[12.5px]">
                        <span className="text-muted-foreground">
                          {todas.length > 1 ? `${p.numero}ª · ` : ""}
                          {diaCurto(p.vencimento)}
                          {a && a.dias > 0 && <span className="ml-1.5 font-semibold text-destructive">venceu</span>}
                        </span>
                        <span className="font-bold tabular-nums">{reais(p.valor)}</span>
                      </li>
                    );
                  })}
                </ul>
                {ficha.compromisso.observacao && <p className="mt-2 text-xs text-muted-foreground">{ficha.compromisso.observacao}</p>}
              </section>
            )}

            <section className="rounded-[18px] border border-border bg-sunken p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                <History className="size-3.5" aria-hidden /> Últimos passos
              </h3>
              <Linha eventos={ficha.eventos.slice(0, 5)} etapas={etapas} />
            </section>

            {ficha.observacoes && (
              <section className="rounded-[18px] border border-border bg-card p-3.5">
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                  <StickyNote className="size-3.5" aria-hidden /> Observações
                </h3>
                <p className="whitespace-pre-line text-[12.5px] text-muted-foreground">{ficha.observacoes}</p>
              </section>
            )}
          </>
        )}

        {secao === "titulos" && (
          <section className="rounded-[18px] border border-border bg-sunken p-3.5">
            <div className="mb-1 grid grid-cols-[1.3fr_0.8fr_0.9fr_1fr_28px] text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              <span>Título</span>
              <span>Vence</span>
              <span>Atraso</span>
              <span className="text-right">Saldo</span>
              <span />
            </div>
            {ficha.titulos.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nenhum título.</p>}
            {ficha.titulos.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "grid grid-cols-[1.3fr_0.8fr_0.9fr_1fr_28px] items-center border-t border-border/60 py-2 text-[12.5px]",
                  t.status !== "aberto" && "text-muted-foreground",
                )}
              >
                <span className="truncate" title={t.descricao ?? undefined}>
                  {t.numero ?? "—"}
                  <span className="ml-1 text-[10.5px] text-muted-foreground">{ROTULO_ORIGEM[t.origem]}</span>
                </span>
                <span className="tabular-nums">{diaCurto(t.vencimento)}</span>
                <span>
                  {t.status === "aberto" ? (
                    <AtrasoSelo vencimento={t.vencimento} />
                  ) : (
                    <span className="text-[11px] font-semibold">
                      {{ pago: "pago", cancelado: "cancelado", baixado: "baixado", aberto: "" }[t.status]}
                      {t.pagoEm ? ` ${diaCurto(t.pagoEm)}` : ""}
                    </span>
                  )}
                </span>
                <span className="text-right font-bold tabular-nums">
                  {/* Fechado não tem saldo: o valor original fica riscado, o motivo está na coluna ao lado. */}
                  {t.status === "aberto" ? reais(t.saldo) : <s className="font-semibold">{reais(t.valor)}</s>}
                  {t.valorPago > 0 && t.status === "aberto" && (
                    <span className="block text-[10.5px] font-medium text-muted-foreground">pago {reais(t.valorPago)}</span>
                  )}
                </span>
                <span>
                  {podeEditar && t.status === "aberto" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={`Cancelar título ${t.numero ?? ""}`}
                      onClick={() => setDialogo({ tipo: "cancelar-titulo", tituloId: t.id })}
                    >
                      <X />
                    </Button>
                  )}
                </span>
              </div>
            ))}
            {podeEditar && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setDialogo({ tipo: "titulo" })}>
                <Plus />
                Incluir título
              </Button>
            )}
          </section>
        )}

        {secao === "historico" && (
          <section className="rounded-[18px] border border-border bg-sunken p-3.5">
            <Linha eventos={ficha.eventos} etapas={etapas} />
          </section>
        )}
      </div>

      {/* diálogos */}
      <InadimplenteDialog aberto={dialogo?.tipo === "editar"} onFechar={fechar} editando={r} observacoesAtuais={ficha.observacoes} />
      <TituloDialog aberto={dialogo?.tipo === "titulo"} onFechar={fechar} inadimplenteId={r.id} />
      {temCaso && (
        <>
          <CompromissoDialog
            aberto={dialogo?.tipo === "compromisso"}
            onFechar={fechar}
            tipoInicial={dialogo?.tipo === "compromisso" ? dialogo.inicial : "promessa"}
            caso={r}
            etapas={etapas}
          />
          <PagamentoDialog aberto={dialogo?.tipo === "pagamento"} onFechar={fechar} caso={r} titulos={ficha.titulos} />
          <ContatoDialog aberto={dialogo?.tipo === "contato"} onFechar={fechar} caso={r} />
        </>
      )}
      <ConfirmarDialog
        aberto={dialogo?.tipo === "arquivar"}
        onFechar={fechar}
        titulo="Arquivar inadimplente"
        descricao="Use quando foi lançado por engano. Os títulos em aberto são cancelados e o caso fecha em Cancelado. O histórico fica guardado."
        rotuloConfirmar="Arquivar"
        pedirMotivo
        perigoso
        confirmando={arquivar.isPending}
        onConfirmar={(motivo) =>
          arquivar.mutate(
            { inadimplenteId: r.id, motivo },
            {
              onSuccess: () => {
                toast.success("Inadimplente arquivado.");
                fechar();
                onFechar();
              },
              onError: falha("Não foi possível arquivar."),
            },
          )
        }
      />
      <ConfirmarDialog
        aberto={dialogo?.tipo === "cancelar-titulo"}
        onFechar={fechar}
        titulo="Cancelar título"
        descricao="Para contestação procedente ou lançamento errado. Sem saldo restante, o caso fecha."
        rotuloConfirmar="Cancelar título"
        pedirMotivo
        perigoso
        confirmando={cancelarTitulo.isPending}
        onConfirmar={(motivo) =>
          dialogo?.tipo === "cancelar-titulo" &&
          cancelarTitulo.mutate(
            { tituloId: dialogo.tituloId, motivo },
            { onSuccess: () => { toast.success("Título cancelado."); fechar(); }, onError: falha("Não foi possível cancelar o título.") },
          )
        }
      />
      <ConfirmarDialog
        aberto={dialogo?.tipo === "quebrar"}
        onFechar={fechar}
        titulo="Marcar quebra do compromisso"
        descricao="O devedor não cumpriu o combinado. O compromisso fica registrado como quebrado; o caso continua aberto."
        rotuloConfirmar="Marcar quebra"
        perigoso
        confirmando={encerrar.isPending}
        onConfirmar={() =>
          ficha.compromisso &&
          encerrar.mutate(
            { compromissoId: ficha.compromisso.id, status: "quebrado" },
            { onSuccess: () => { toast.success("Quebra registrada."); fechar(); }, onError: falha("Não foi possível registrar a quebra.") },
          )
        }
      />
    </div>
  );
}

function AcaoBotao({ icone: Icone, rotulo, onClick }: { icone: LucideIcon; rotulo: string; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-10 justify-center gap-1.5 px-2 text-[12.5px]" onClick={onClick}>
      <Icone />
      {rotulo}
    </Button>
  );
}

/** Mora dentro do painel de tinta, que reescopa `text-destructive` para o vermelho legível no escuro. */
function Pastilha({ rotulo, valor, destaque, className }: { rotulo: string; valor: string; destaque?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-[14px] border border-tinta-line/60 bg-tinta-2 px-3 py-2", className)}>
      <p className="truncate text-[10.5px] text-tinta-muted">{rotulo}</p>
      <p className={cn("mt-0.5 truncate text-[15px] font-extrabold tabular-nums tracking-[-0.02em]", destaque && "text-destructive")}>
        {valor}
      </p>
    </div>
  );
}

const ICONE_DO_CANAL: Record<CanalDeContato, LucideIcon> = {
  whatsapp: MessageCircle,
  telefone: Phone,
  email: Mail,
  presencial: Users,
  outro: Phone,
};

const ICONE_DO_EVENTO: Record<string, LucideIcon> = {
  pagamento_registrado: Receipt,
  promessa_registrada: CalendarClock,
  acordo_registrado: Handshake,
  contato_registrado: Phone,
  nao_contatar_alterado: BellOff,
  inadimplente_arquivado: Archive,
};

function textoDoEvento(e: EventoDoCaso, nomeDe: (id: string | null) => string, etapaNome: (id: unknown) => string): string {
  const d = e.dados;
  const quem = nomeDe(e.autorId);
  switch (e.tipo) {
    case "inadimplente_criado":
      return `${quem} cadastrou (${d.origem === "planilha" ? "importação de planilha" : d.origem === "erp" ? "ERP" : "manual"})`;
    case "inadimplente_editado":
      return `${quem} editou os dados`;
    case "inadimplente_arquivado":
      return `${quem} arquivou: ${String(d.motivo ?? "")}`;
    case "titulo_incluido":
      return `Título incluído · ${reais(Number(d.valor ?? 0))}`;
    case "titulo_cancelado":
      return `${quem} cancelou um título: ${String(d.motivo ?? "")}`;
    case "importado":
      return "Atualizado por importação de planilha";
    case "caso_aberto":
      return "Caso aberto no Fluxo de Cobrança";
    case "etapa_alterada":
      return `${quem} moveu para ${etapaNome(d.para)}`;
    case "responsavel_alterado":
      return `${quem} trocou o responsável`;
    case "caso_encerrado":
      return `Caso encerrado: ${ROTULO_DESFECHO[d.desfecho as keyof typeof ROTULO_DESFECHO] ?? String(d.desfecho)}`;
    case "promessa_registrada":
      return `${quem} registrou promessa · ${reais(Number(d.total ?? 0))} em ${diaCurto(String(d.primeira ?? ""))}`;
    case "acordo_registrado":
      return `${quem} registrou acordo · ${d.parcelas}x, ${reais(Number(d.total ?? 0))}`;
    case "compromisso_encerrado":
      return `Compromisso ${d.status === "quebrado" ? "quebrado" : d.status === "cumprido" ? "cumprido" : "cancelado"}`;
    case "pagamento_registrado":
      return `${quem} registrou pagamento · ${reais(Number(d.valor ?? 0))}`;
    case "contato_registrado":
      return `${quem}: ${ROTULO_CANAL[d.canal as CanalDeContato] ?? "contato"} · ${ROTULO_RESULTADO[d.resultado as ResultadoDoContato] ?? ""}`;
    case "nao_contatar_alterado":
      return d.valor ? `${quem} marcou "não contatar"` : `${quem} liberou mensagens`;
    default:
      return e.tipo;
  }
}

function Linha({ eventos, etapas: lista }: { eventos: EventoDoCaso[]; etapas: Etapa[] }) {
  const { data: membros = [] } = useTeamMembers();
  const etapas = new Map(lista.map((e) => [e.id, e.nome]));
  const nomePorUsuario = new Map(membros.filter((m) => m.user_id).map((m) => [m.user_id as string, m.name]));
  const nomeDe = (id: string | null) => (id ? (nomePorUsuario.get(id)?.split(" ")[0] ?? "Equipe") : "Torque");
  const etapaNome = (id: unknown) => (typeof id === "string" ? (etapas.get(id) ?? "outra etapa") : "outra etapa");

  if (eventos.length === 0) return <p className="py-3 text-center text-xs text-muted-foreground">Nada registrado ainda.</p>;
  return (
    <ol className="space-y-0.5">
      {eventos.map((e) => {
        const Icone =
          (e.tipo === "contato_registrado" ? ICONE_DO_CANAL[e.dados.canal as CanalDeContato] : undefined) ??
          ICONE_DO_EVENTO[e.tipo] ??
          History;
        const nota = typeof e.dados.nota === "string" ? e.dados.nota : null;
        return (
          <li key={e.id} className="grid grid-cols-[26px_1fr_auto] gap-2.5 py-1.5">
            <span className="grid size-[26px] place-items-center rounded-[9px] bg-card text-muted-foreground shadow-relevo">
              <Icone className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 text-[12.5px] leading-snug">
              {textoDoEvento(e, nomeDe, etapaNome)}
              {nota && <q className="mt-1 block rounded-xl border border-border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground before:content-none after:content-none">{nota}</q>}
            </div>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">{haQuantoTempo(e.criadoEm)}</span>
          </li>
        );
      })}
    </ol>
  );
}
