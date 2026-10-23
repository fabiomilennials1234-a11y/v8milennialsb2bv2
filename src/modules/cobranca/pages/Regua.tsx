/**
 * Régua de cobrança (ADR-0040): o que o Torque manda sozinho, quando e para
 * quem — pelo número exclusivo da cobrança. A régua de atraso são as COLUNAS
 * do Fluxo (entram sozinhas por dias de atraso); o resto são lembretes.
 *
 * Nasce desligada. Ligar mostra antes quantas mensagens sairiam e por qual
 * número; desligar esvazia a fila (religar replaneja do zero, sem rajada).
 */
import { AlertTriangle, Loader2, Lock } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useIdentity } from "@/modules/identity";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { formatarTelefone } from "../lib/documento";
import { recusaDaCobranca } from "../lib/erros";
import { plural } from "../lib/formato";
import { quandoAbre } from "../lib/regua";
import { useEtapas } from "../hooks/useCobrancaDados";
import { useCobrancaAcesso } from "../hooks/useCobrancaAcesso";
import { useAtivarRegua, useEnviosDaRegua, usePreviaDaRegua, useRegua } from "../hooks/useRegua";
import { CobrancaTabs } from "../components/CobrancaTabs";
import { AjustesDaRegua, NumeroDaCobranca } from "../components/regua/AjustesDaRegua";
import { ColunasDaRegua } from "../components/regua/ColunasDaRegua";
import { HojeNaRegua } from "../components/regua/HojeNaRegua";
import { PassosDaRegua } from "../components/regua/PassosDaRegua";

function Celula({ rotulo, valor, nota }: { rotulo: string; valor: ReactNode; nota: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 border-t border-tinta-line/70 px-4 py-3 even:border-l sm:border-l sm:border-t-0">
      <p className="text-xs font-semibold text-tinta-muted sm:truncate">{rotulo}</p>
      <p className="mt-1 truncate text-[22px] font-extrabold tabular-nums tracking-[-0.04em]">{valor}</p>
      <div className="mt-0.5 text-[11.5px] text-tinta-muted sm:truncate">{nota}</div>
    </div>
  );
}

export default function Regua() {
  const { podeEditar } = useCobrancaAcesso();
  const { isAdmin } = useIdentity();
  const { data: etapas = [] } = useEtapas();
  const regua = useRegua();
  const previa = usePreviaDaRegua();
  const envios = useEnviosDaRegua();
  const ativar = useAtivarRegua();
  const [confirmarLigar, setConfirmarLigar] = useState(false);

  const cfg = regua.data?.configuracao ?? null;
  const numero = regua.data?.numeros.find((n) => n.reservadoPara === "collections") ?? null;
  const p = previa.data;
  const vaoSair = p?.candidatos.filter((c) => c.status === "pendente").length ?? 0;
  const temMensagem =
    etapas.some((e) => e.papel === "aberta" && e.automacaoAtiva && !!e.mensagem) ||
    (regua.data?.passos.some((x) => x.ativo && x.mensagem) ?? false);
  const pronta = !!numero?.conectado && temMensagem;

  const alternar = (ligar: boolean) => {
    if (ligar) return setConfirmarLigar(true);
    ativar.mutate(false, {
      onSuccess: () => toast.success("Régua desligada. A fila foi esvaziada."),
      onError: (err) =>
        notifyError(err, { fallback: "Não foi possível desligar.", message: recusaDaCobranca(err as never), context: { feature: "cobranca" } }),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Cobrança"
        title="Régua de cobrança"
        subtitle="O que o Torque manda sozinho, quando e para quem. Negociar continua com a equipe."
        actions={
          cfg && podeEditar ? (
            <label
              className={cn(
                "flex h-10 items-center gap-2.5 rounded-full border px-3.5 text-sm font-bold",
                cfg.ativa ? "border-success/40 bg-success/10 text-success-strong" : "border-border bg-card text-muted-foreground",
              )}
            >
              {ativar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {cfg.ativa ? "Ligada" : "Desligada"}
              <Switch checked={cfg.ativa} onCheckedChange={alternar} disabled={ativar.isPending} aria-label="Régua ligada" />
            </label>
          ) : undefined
        }
        tabs={<CobrancaTabs ativa="regua" />}
      />

      {regua.isLoading || !cfg ? (
        <div className="grid h-60 place-items-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <section
            aria-label="Estado da régua"
            className="flex flex-col rounded-card bg-tinta p-1.5 text-tinta-foreground shadow-relevo-tinta sm:flex-row"
          >
            <div className="flex w-full shrink-0 flex-col justify-center gap-1.5 px-4 py-3 sm:w-[260px]">
              <p className="flex items-center gap-2 text-[13px] font-extrabold">
                <span aria-hidden className={cn("size-2 rounded-full", cfg.ativa ? "bg-success" : "bg-tinta-muted")} />
                {cfg.ativa ? "Régua ligada" : "Régua desligada"}
              </p>
              <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-tinta-muted">
                <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                {numero
                  ? `Envia só pelo número “${numero.nome}”${numero.telefone ? ` · ${formatarTelefone(numero.telefone)}` : ""}.`
                  : "Sem número da cobrança: nada sai."}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:contents">
              <Celula
                rotulo="Enviadas hoje"
                valor={p ? `${p.enviadosHoje}/${p.tetoDiario}` : "·"}
                nota="limite do dia"
              />
              <Celula rotulo="Na fila" valor={p ? p.naFila : "·"} nota="aguardando a vez" />
              <Celula
                rotulo={cfg.ativa ? "Entram na próxima rodada" : "Sairiam agora"}
                valor={p ? vaoSair : "·"}
                nota={p ? plural(p.candidatos.length - vaoSair, "não recebe (motivo na lista)", "não recebem (motivo na lista)") : " "}
              />
              <Celula
                rotulo="Janela de envio"
                valor={p ? (p.naJanela ? "Aberta" : "Fechada") : "·"}
                nota={p ? (p.naJanela ? "dentro do horário" : `abre ${quandoAbre(p.proximaJanela)}`) : " "}
              />
            </div>
          </section>

          {!numero && (
            <p className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning-strong">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              Escolha o número da cobrança em “Número da cobrança” para a régua poder enviar.
            </p>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <ColunasDaRegua
                etapas={etapas}
                comoPagar={cfg.comoPagar}
                empresa={regua.data?.empresa ?? undefined}
                podeEditar={podeEditar}
              />
              <PassosDaRegua
                passos={regua.data?.passos ?? []}
                comoPagar={cfg.comoPagar}
                empresa={regua.data?.empresa ?? undefined}
                podeEditar={podeEditar}
              />
              <HojeNaRegua
                previa={p}
                envios={envios.data ?? []}
                carregandoEnvios={envios.isLoading}
                podeEditar={podeEditar}
              />
            </div>
            <div className="min-w-0 space-y-4">
              <NumeroDaCobranca numeros={regua.data?.numeros ?? []} podeEditar={podeEditar} ehAdmin={isAdmin} />
              <AjustesDaRegua config={cfg} etapas={etapas} podeEditar={podeEditar} />
            </div>
          </div>
        </>
      )}

      <Dialog open={confirmarLigar} onOpenChange={setConfirmarLigar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ligar a régua?</DialogTitle>
            <DialogDescription>
              {pronta
                ? `A partir da próxima rodada, mensagens saem sozinhas pelo número “${numero?.nome ?? ""}”, só no horário configurado e até ${cfg?.tetoDiario ?? 0} por dia.`
                : "Falta o número da cobrança conectado ou uma coluna (ou lembrete) com mensagem ligada."}
            </DialogDescription>
          </DialogHeader>
          {pronta && p && (
            <div className="rounded-2xl border border-border bg-sunken px-3.5 py-3 text-sm">
              <p className="font-bold tabular-nums">{plural(vaoSair, "mensagem entra", "mensagens entram")} na fila agora</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.naJanela ? "A janela está aberta: começam a sair em minutos." : `Fora da janela: começam ${quandoAbre(p.proximaJanela)}.`}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarLigar(false)}>
              Voltar
            </Button>
            <Button
              disabled={!pronta || ativar.isPending}
              onClick={() =>
                ativar.mutate(true, {
                  onSuccess: () => {
                    setConfirmarLigar(false);
                    toast.success("Régua ligada.");
                  },
                  onError: (err) =>
                    notifyError(err, { fallback: "Não foi possível ligar.", message: recusaDaCobranca(err as never), context: { feature: "cobranca" } }),
                })
              }
            >
              {ativar.isPending && <Loader2 className="animate-spin" />}
              Ligar a régua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
