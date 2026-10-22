/**
 * Cobrança · Fluxo de Cobrança — o kanban dos casos (ADR-0040).
 *
 * Parece um funil, mas não é: as etapas são da cobrança, o card é um caso (um
 * por inadimplente) e a faixa de números lê só as tabelas da cobrança. Nada
 * daqui entra em funis de venda, conversão, comissão ou Estúdio de Métricas.
 *
 * As colunas são a régua: "N dias de atraso" recebe o caso sozinho. Soltar um
 * card numa coluna que manda mensagem pergunta antes ("Mover e enviar").
 */
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { DeltaChip } from "@/components/ui/bento";
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
import { useOrganization, useTeamMembers } from "@/modules/identity";
import { FilterChip } from "@/shared/components/FilterChip";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { recusaDaCobranca } from "../lib/erros";
import { plural, reaisCompacto } from "../lib/formato";
import { ROTULO_BLOQUEIO, type ResultadoDoEnvioManual } from "../lib/regua";
import type { Etapa, InadimplenteResumo } from "../lib/tipos";
import { CHAVE_COBRANCA, useCasosAbertos, useCasosEncerrados, useEtapas, useMetricas } from "../hooks/useCobrancaDados";
import { useCobrancaAcesso } from "../hooks/useCobrancaAcesso";
import { useMoverCaso } from "../hooks/useCobrancaMutacoes";
import { CobrancaTabs } from "../components/CobrancaTabs";
import { ConfirmarDialog, InadimplenteDialog, PagamentoDialog } from "../components/dialogos";
import { FluxoQuadro } from "../components/FluxoQuadro";
import { InadimplenteGaveta } from "../components/InadimplenteGaveta";
import { MoverEEnviarDialog } from "../components/MoverEEnviarDialog";

/** O que dizer depois de "Mover e enviar", pelo que o banco devolveu. */
function avisarEnvio(envio: ResultadoDoEnvioManual) {
  if (envio === "na_fila") return toast.success("Card movido. A mensagem entrou na fila da régua.");
  if (envio === "ja_enviado_hoje") return toast("Card movido. A mensagem desta coluna já foi hoje para este devedor.");
  if (envio) return toast.warning(`Card movido, mensagem não enviada. ${ROTULO_BLOQUEIO[envio]}`);
}

function Celula({ rotulo, valor, nota }: { rotulo: string; valor: ReactNode; nota: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 border-t border-tinta-line/70 px-4 py-3 even:border-l sm:border-l sm:border-t-0">
      {/* No 2×2 do celular a coluna é estreita: rótulo e nota quebram em vez de cortar. */}
      <p className="text-xs font-semibold text-tinta-muted sm:truncate">{rotulo}</p>
      <p className="mt-1 truncate text-[22px] font-extrabold tabular-nums tracking-[-0.04em]">{valor}</p>
      <div className="mt-0.5 text-[11.5px] text-tinta-muted sm:truncate">{nota}</div>
    </div>
  );
}

export default function FluxoDeCobranca() {
  const { podeEditar } = useCobrancaAcesso();
  const { organizationId } = useOrganization();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [busca, setBusca] = useState("");
  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [pendente, setPendente] = useState<null | { caso: InadimplenteResumo; destino: Etapa }>(null);
  const [comMensagem, setComMensagem] = useState<null | { caso: InadimplenteResumo; destino: Etapa }>(null);

  const { data: etapas = [] } = useEtapas();
  const { data: casos = [], isLoading } = useCasosAbertos();
  const { data: encerrados = [] } = useCasosEncerrados();
  const { data: m } = useMetricas();
  const { data: membros = [] } = useTeamMembers();
  const mover = useMoverCaso();

  const aberto = params.get("inadimplente");
  const abrir = (id: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("inadimplente", id);
      return n;
    });
  const fecharFicha = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete("inadimplente");
      return n;
    }, { replace: true });

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return casos.filter(
      (c) =>
        (!t || c.nome.toLowerCase().includes(t) || (c.documento ?? "").includes(t.replace(/\D/g, "") || "§")) &&
        (!responsavel || (responsavel === "sem" ? !c.responsavelId : c.responsavelId === responsavel)),
    );
  }, [casos, busca, responsavel]);

  // Move já na tela; se o banco recusar, o refetch devolve o card ao lugar.
  const moverOtimista = (caso: InadimplenteResumo, destino: Etapa, enviar = false) => {
    const chave = [CHAVE_COBRANCA, organizationId, "quadro"];
    qc.setQueryData<InadimplenteResumo[]>(chave, (lista) =>
      (lista ?? []).map((c) =>
        c.casoId === caso.casoId ? { ...c, etapaId: destino.id, etapaNome: destino.nome, etapaCor: destino.cor } : c,
      ),
    );
    mover.mutate(
      { casoId: caso.casoId as string, etapaId: destino.id, enviar },
      {
        onSuccess: (envio) => {
          if (enviar) avisarEnvio(envio);
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível mover o caso.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  const soltar = (caso: InadimplenteResumo, destino: Etapa) => {
    if (!podeEditar) return;
    // Coluna que manda mensagem: pergunta antes, com a prévia.
    if (destino.papel === "aberta" && destino.mensagem) return setComMensagem({ caso, destino });
    if (destino.papel === "aberta") return moverOtimista(caso, destino);
    // Recuperado sem saldo é só mover; com saldo, a tela pede o pagamento.
    if (destino.papel === "recuperado" && caso.saldoAberto <= 0) return moverOtimista(caso, destino);
    setPendente({ caso, destino });
  };

  const delta =
    m && m.recuperadoMesAnterior > 0 ? ((m.recuperadoMes - m.recuperadoMesAnterior) / m.recuperadoMesAnterior) * 100 : undefined;
  const membrosAtivos = membros.filter((x) => x.is_active !== false && x.id);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Cobrança"
        title="Fluxo de Cobrança"
        subtitle="Um caso por inadimplente, da primeira cobrança ao desfecho. As métricas daqui não entram nos funis de venda."
        actions={
          podeEditar ? (
            <Button onClick={() => setNovo(true)}>
              <Plus />
              Novo inadimplente
            </Button>
          ) : undefined
        }
        tabs={<CobrancaTabs ativa="fluxo" abertos={m?.casosAbertos} />}
      />

      <section
        aria-label="Métricas do fluxo"
        className="flex flex-col rounded-card bg-tinta p-1.5 text-tinta-foreground shadow-relevo-tinta sm:flex-row"
      >
        <div className="flex w-full shrink-0 flex-col justify-center gap-1.5 px-4 py-3 sm:w-[220px]">
          <p className="text-[13px] font-extrabold">Métricas do fluxo</p>
          <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-tinta-muted">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
            Isoladas: não somam em funis, conversão nem Estúdio de Métricas.
          </p>
        </div>
        {/* Celular: 2×2. Do sm para cima o invólucro some e as células voltam à faixa. */}
        <div className="grid grid-cols-2 sm:contents">
          <Celula
            rotulo="Em aberto no fluxo"
            valor={m ? reaisCompacto(m.emAberto) : "·"}
            nota={m ? `${plural(m.casosAbertos, "caso", "casos")} · ${plural(m.titulosAbertos, "título", "títulos")}` : " "}
          />
          <Celula
            rotulo="Recuperado no mês"
            valor={m ? reaisCompacto(m.recuperadoMes) : "·"}
            nota={delta !== undefined ? <DeltaChip value={delta} label="vs mês anterior" className="text-[11px]" /> : m ? plural(m.recuperadosMes, "caso quitado", "casos quitados") : " "}
          />
          <Celula
            rotulo="Acordos e promessas ativos"
            valor={m ? reaisCompacto(m.acordosAtivosValor) : "·"}
            nota={m ? `${plural(m.acordosAtivos, "compromisso", "compromissos")} · ${plural(m.quebrasMes, "quebra", "quebras")} no mês` : " "}
          />
          <Celula
            rotulo="Tempo até pagar"
            valor={m?.diasAtePagarMediana != null ? plural(Math.round(m.diasAtePagarMediana), "dia", "dias") : "—"}
            nota="mediana do vencimento ao pagamento"
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[300px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Buscar inadimplente ou CPF/CNPJ…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-[34px] rounded-full pl-10 shadow-relevo"
            aria-label="Buscar no quadro"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip caret active={!!responsavel}>
              {responsavel === "sem"
                ? "Sem responsável"
                : responsavel
                  ? `Responsável: ${membrosAtivos.find((x) => x.id === responsavel)?.name ?? ""}`
                  : "Responsável"}
            </FilterChip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
            <DropdownMenuRadioGroup value={responsavel ?? "todos"} onValueChange={(v) => setResponsavel(v === "todos" ? null : v)}>
              <DropdownMenuRadioItem value="todos">Todos</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sem">Sem responsável</DropdownMenuRadioItem>
              {membrosAtivos.length > 0 && <DropdownMenuSeparator />}
              {membrosAtivos.map((x) => (
                <DropdownMenuRadioItem key={x.id} value={x.id}>
                  {x.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {!podeEditar && <span className="text-xs text-muted-foreground">Somente leitura</span>}
      </div>

      <div className={cn("transition-opacity", isLoading && "opacity-60")}>
        <FluxoQuadro
          etapas={etapas}
          casos={visiveis}
          encerrados={encerrados}
          onAbrir={abrir}
          onSoltar={soltar}
          podeArrastar={podeEditar}
        />
      </div>

      <InadimplenteGaveta inadimplenteId={aberto} onFechar={fecharFicha} etapas={etapas} podeEditar={podeEditar} />
      <InadimplenteDialog aberto={novo} onFechar={() => setNovo(false)} onSalvo={abrir} />

      {comMensagem && (
        <MoverEEnviarDialog
          key={`${comMensagem.caso.casoId}:${comMensagem.destino.id}`}
          caso={comMensagem.caso}
          destino={comMensagem.destino}
          onFechar={() => setComMensagem(null)}
          onMover={(enviar) => {
            moverOtimista(comMensagem.caso, comMensagem.destino, enviar);
            setComMensagem(null);
          }}
        />
      )}
      {/* Soltar em Recuperado: com saldo, a baixa é o pagamento (o banco recusa o mover). */}
      {pendente?.destino.papel === "recuperado" && pendente.caso.saldoAberto > 0 && (
        <PagamentoDialog aberto onFechar={() => setPendente(null)} caso={pendente.caso} />
      )}
      {pendente && (pendente.destino.papel === "perdido" || pendente.destino.papel === "cancelado") && (
        <ConfirmarDialog
          aberto
          onFechar={() => setPendente(null)}
          titulo={pendente.destino.papel === "perdido" ? `Baixar ${pendente.caso.nome} como perda?` : `Cancelar a cobrança de ${pendente.caso.nome}?`}
          descricao={
            pendente.destino.papel === "perdido"
              ? "Os títulos em aberto saem do saldo como perda e o caso fecha. Fica registrado no histórico; uma dívida nova abre outro caso."
              : "Para contestação procedente ou cobrança indevida: os títulos em aberto são cancelados e o caso fecha."
          }
          rotuloConfirmar={pendente.destino.papel === "perdido" ? "Baixar como perda" : "Cancelar cobrança"}
          perigoso
          confirmando={mover.isPending}
          onConfirmar={() =>
            mover.mutate(
              { casoId: pendente.caso.casoId as string, etapaId: pendente.destino.id },
              {
                onSuccess: () => {
                  toast.success("Caso encerrado.");
                  setPendente(null);
                },
                onError: (err) =>
                  notifyError(err, {
                    fallback: "Não foi possível encerrar o caso.",
                    message: recusaDaCobranca(err as { code?: string; message?: string }),
                    context: { feature: "cobranca" },
                  }),
              },
            )
          }
        />
      )}
    </div>
  );
}
