/**
 * "Buscas" no topo da aba Lista fria: o que está rodando, com a trilha de
 * etapas, o progresso e os créditos ao vivo, e o que terminou e espera revisão
 * (mockup 4 do board Miro). A tela confere o banco a cada 4 s enquanto houver
 * busca aberta (ver `useBuscas`).
 */
import { Building2, Check, Loader2, MapPin, Pause, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { usePararBusca } from "../hooks/useListaFriaMutacoes";
import { useBuscas, useSaldos } from "../hooks/useListaFriaDados";
import { recusaDaListaFria } from "../lib/erros";
import {
  ETAPAS_DA_BUSCA,
  ROTULO_FONTE,
  ROTULO_STATUS,
  type Busca,
  buscaEstaAberta,
  buscaPedeRevisao,
} from "../lib/tipos";

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

function FonteIcone({ fonte }: { fonte: Busca["fonte"] }) {
  if (fonte === "cnpj") return <Building2 className="size-[19px]" aria-hidden />;
  return fonte === "maps" ? (
    <MapPin className="size-[19px]" aria-hidden />
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-[19px]" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}

// CNPJ não lê site nem usa IA: a trilha só mostra o que essa fonte faz.
const ETAPAS_DO_CNPJ: ReadonlySet<string> = new Set(["coletando", "validando"]);

function Trilha({ busca }: { busca: Busca }) {
  const etapas = busca.fonte === "cnpj" ? ETAPAS_DA_BUSCA.filter((e) => ETAPAS_DO_CNPJ.has(e.chave)) : ETAPAS_DA_BUSCA;
  const atual = busca.etapa ? etapas.findIndex((e) => e.chave === busca.etapa) : -1;
  const concluida = busca.status === "concluida" || busca.status === "parada";
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Etapas da busca">
      {etapas.map((e, i) => {
        const feita = concluida || i < atual;
        const emCurso = !concluida && i === atual;
        return (
          <li
            key={e.chave}
            aria-current={emCurso ? "step" : undefined}
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded-full px-2.5 text-[11px] font-bold",
              feita && "bg-success/15 text-success-strong",
              emCurso && "bg-primary-soft text-primary-soft-foreground",
              !feita && !emCurso && "bg-muted text-muted-foreground",
            )}
          >
            {feita && <Check className="size-3" strokeWidth={3} aria-hidden />}
            {e.rotulo}
          </li>
        );
      })}
    </ol>
  );
}

function Numero({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <span className="text-xs text-muted-foreground">
      <b className={cn("text-[15px] tabular-nums", destaque ? "text-primary" : "text-foreground")}>{numero(valor)}</b> {rotulo}
    </span>
  );
}

function LinhaDeBusca({ busca, podeEditar }: { busca: Busca; podeEditar: boolean }) {
  const parar = usePararBusca();
  const aberta = buscaEstaAberta(busca);
  const naFila = busca.status === "na_fila";

  const pararAgora = () =>
    parar.mutate(busca.id, {
      onSuccess: () => toast.success(naFila ? "Busca cancelada. Os créditos voltaram." : "Busca parada. Você fica com o que já achou."),
      onError: (err) =>
        notifyError(err, {
          fallback: "Não foi possível parar a busca.",
          message: recusaDaListaFria(err as { code?: string; message?: string }),
          context: { feature: "lista-fria" },
        }),
    });

  return (
    <div className="space-y-3.5 px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <FonteIcone fonte={busca.fonte} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{busca.titulo}</p>
            <p className="text-xs text-muted-foreground">
              {ROTULO_FONTE[busca.fonte]} · {ROTULO_STATUS[busca.status].toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {aberta && podeEditar && (
            <Button type="button" size="sm" variant="outline" onClick={pararAgora} disabled={parar.isPending}>
              {parar.isPending ? <Loader2 className="animate-spin" /> : <Pause />}
              {naFila ? "Cancelar" : "Parar e ficar com o que achou"}
            </Button>
          )}
          {buscaPedeRevisao(busca) && (
            <Button asChild size="sm">
              <Link to={`/leads/lista-fria/${busca.id}`}>Revisar e importar</Link>
            </Button>
          )}
          {busca.status === "falhou" && busca.erro && (
            <span className="text-xs text-destructive-strong">Não deu para terminar. Os créditos não usados voltaram.</span>
          )}
        </div>
      </div>

      {(aberta || busca.status === "concluida" || busca.status === "parada") && <Trilha busca={busca} />}

      {aberta ? (
        <div className="flex items-center gap-3.5">
          <Progress value={busca.progresso} className="h-2 flex-1" aria-label="Progresso da busca" />
          <b className="w-10 text-right text-sm tabular-nums">{busca.progresso}%</b>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Numero valor={busca.encontrados} rotulo="negócios encontrados" />
        <Numero valor={busca.comTelefone} rotulo="com telefone" />
        <Numero valor={busca.comEmail} rotulo="com e-mail" />
        <span className="text-xs text-muted-foreground">
          <b className="text-[15px] tabular-nums text-primary">{numero(busca.creditosUsados)}</b> de {numero(busca.creditosLimite)} créditos usados
        </span>
        {busca.status === "parada" && busca.creditosUsados >= busca.creditosLimite && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">parou no limite de créditos</span>
        )}
      </div>
    </div>
  );
}

export function BuscasCard({ podeEditar }: { podeEditar: boolean }) {
  const { data: buscas = [], isLoading } = useBuscas();
  const { data: saldos } = useSaldos();
  // O card mostra o que está aberto e o que terminou há pouco; o resto vira histórico.
  const visiveis = buscas.filter((b) => buscaEstaAberta(b) || buscaPedeRevisao(b) || b.status === "falhou").slice(0, 5);

  return (
    <section aria-label="Buscas da Lista fria" className="overflow-hidden rounded-[22px] border border-card-border bg-card shadow-relevo">
      <header className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h2 className="text-[15px] font-extrabold tracking-tight">Buscas</h2>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Zap className="size-3.5" aria-hidden />
          Saldo: <b className="text-sm tabular-nums text-primary">{saldos === undefined ? "·" : numero(saldos.normal)}</b> créditos
          {saldos !== undefined && saldos.meta > 0 && (
            <>
              {" · "}
              <b className="text-sm tabular-nums text-primary">{numero(saldos.meta)}</b> Meta
            </>
          )}
        </p>
      </header>
      {isLoading ? (
        <div className="grid h-24 place-items-center text-muted-foreground" role="status" aria-label="Carregando">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : visiveis.length === 0 ? (
        <p className="px-5 pb-5 pt-2 text-[13px] text-muted-foreground">
          Nenhuma busca em andamento. Use <b className="text-foreground">Nova busca</b> para trazer contatos do Instagram ou do Google Maps.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {visiveis.map((b) => (
            <LinhaDeBusca key={b.id} busca={b} podeEditar={podeEditar} />
          ))}
        </div>
      )}
      {visiveis.some(buscaEstaAberta) && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Você pode sair desta tela. A busca continua e o resultado aparece aqui quando terminar.
        </p>
      )}
    </section>
  );
}
