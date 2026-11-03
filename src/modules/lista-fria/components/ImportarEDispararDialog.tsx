/**
 * Lista Fria · "Importar e Disparar" (ADR-0048).
 *
 * O usuário escolhe funil e etapa, escreve a mensagem, escolhe de qual número ela
 * sai e a cadência. Ao confirmar, o servidor importa os contatos selecionados,
 * abre um negócio de cada um nesse funil/etapa e cria o disparo cadenciado.
 */
import { AlertTriangle, Clock, Loader2, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWhatsAppInstances } from "@/modules/communication";
import { useFunisAtivosDaOrg, useStagesDoFunil } from "@/modules/pipelines";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { RecusaDoDisparo, useImportarEDisparar } from "../hooks/useImportarEDisparar";
import {
  CADENCIAS,
  CADENCIA_PADRAO,
  LIMITE_DA_MENSAGEM,
  TEXTO_DA_JANELA,
  VARIAVEIS_DO_DISPARO,
  chipPodeDispararFrio,
  dentroDaJanelaFria,
  pendenciasDoPedido,
  type CadenciaDoDisparo,
} from "../lib/disparo";

const n = (v: number) => v.toLocaleString("pt-BR");

interface Props {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  buscaId: string;
  /** Contatos que vão entrar: os selecionados que ainda não são leads. */
  selecionados: number;
}

export function ImportarEDispararDialog({ open, onOpenChange, buscaId, selecionados }: Props) {
  const navigate = useNavigate();
  const disparar = useImportarEDisparar();

  const [funilId, setFunilId] = useState("");
  const [etapaId, setEtapaId] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [chipIds, setChipIds] = useState<string[]>([]);
  const [cadencia, setCadencia] = useState<CadenciaDoDisparo["id"]>(CADENCIA_PADRAO);

  const { data: funis = [] } = useFunisAtivosDaOrg();
  const { data: etapasDoFunil } = useStagesDoFunil(funilId || null);
  const { data: instancias = [] } = useWhatsAppInstances();

  const funil = funis.find((f) => f.id === funilId);
  // Negócio não nasce ganho nem perdido: o servidor também recusa essas etapas.
  const etapas = useMemo(
    () => (etapasDoFunil ?? []).filter((e) => !e.is_final_positive && !e.is_final_negative),
    [etapasDoFunil],
  );
  const chips = useMemo(() => instancias.filter(chipPodeDispararFrio), [instancias]);

  const pedido = { funilId, etapaId, mensagem, chipIds, cadencia };
  const pendencias = pendenciasDoPedido(pedido);
  const naJanela = dentroDaJanelaFria();
  const podeConfirmar = pendencias.length === 0 && naJanela && selecionados > 0 && !disparar.isPending;
  // A coluna existe em `pipelines`, mas os tipos gerados ainda não a trazem.
  const automacaoDaEtapa = (funil as { stage_dispatch_enabled?: boolean } | undefined)?.stage_dispatch_enabled === true;

  const alternarChip = (id: string, marcado: boolean) =>
    setChipIds((atual) => (marcado ? [...atual, id] : atual.filter((x) => x !== id)));

  const confirmar = () =>
    disparar.mutate(
      { buscaId, pedido },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          const falta = r.semNegocio > 0 ? ` ${n(r.semNegocio)} não ganharam negócio e ficaram sem mensagem.` : "";
          toast.success(
            `${n(r.importados)} importados, ${n(r.negocios)} negócios abertos em ${funil?.label ?? "o funil"}. ` +
              `Disparo em ${n(r.lotes)} ${r.lotes === 1 ? "dia" : "dias"}, hoje sai o que couber no limite do número.${falta}`,
          );
          navigate("/leads?aba=lista_fria");
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "O disparo parou no meio. O que já entrou ficou na Lista fria e no funil.",
            message: err instanceof RecusaDoDisparo ? err.message : undefined,
            context: { feature: "lista-fria" },
          }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(v) => !disparar.isPending && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar e disparar {n(selecionados)} contatos</DialogTitle>
          <DialogDescription>
            Os contatos entram na Lista fria, ganham um negócio no funil que você escolher e recebem a mensagem, um de cada vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="disparo-funil">Funil</Label>
              <Select
                value={funilId}
                onValueChange={(v) => {
                  setFunilId(v);
                  setEtapaId("");
                }}
              >
                <SelectTrigger id="disparo-funil">
                  <SelectValue placeholder="Escolha o funil" />
                </SelectTrigger>
                <SelectContent>
                  {funis.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="disparo-etapa">Etapa do negócio</Label>
              <Select value={etapaId} onValueChange={setEtapaId} disabled={!funilId}>
                <SelectTrigger id="disparo-etapa">
                  <SelectValue placeholder={funilId ? "Escolha a etapa" : "Escolha o funil primeiro"} />
                </SelectTrigger>
                <SelectContent>
                  {etapas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {automacaoDaEtapa && (
            <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px]" role="note">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
              <span>
                Este funil tem <b>disparo por etapa</b> ligado. Se a etapa escolhida tiver uma mensagem automática, o contato recebe
                ela além da que você escreve aqui.
              </span>
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="disparo-mensagem">Mensagem</Label>
            <Textarea
              id="disparo-mensagem"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              rows={5}
              maxLength={LIMITE_DA_MENSAGEM + 200}
              placeholder="Oi {{primeiro_nome}}, tudo bem? …"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Inserir:</span>
              {VARIAVEIS_DO_DISPARO.map((v) => (
                <button
                  key={v.chave}
                  type="button"
                  onClick={() => setMensagem((m) => `${m}{{${v.chave}}}`)}
                  className="h-6 rounded-full border border-border px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {v.rotulo}
                </button>
              ))}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {n(mensagem.length)}/{n(LIMITE_DA_MENSAGEM)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Varie o texto com <code>{"{Oi|Olá|E aí}"}</code>: cada contato recebe uma das opções.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Número de envio</legend>
            {chips.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nenhum número disponível. O disparo usa números WhatsApp comuns, e o número da cobrança fica de fora.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {chips.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-primary/60 has-[:checked]:bg-primary/[0.05]">
                      <Checkbox checked={chipIds.includes(c.id)} onCheckedChange={(v) => alternarChip(c.id, v === true)} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.instance_name}</span>
                        {c.phone_number && <span className="block text-xs tabular-nums text-muted-foreground">{c.phone_number}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Cadência</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
              {CADENCIAS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={cadencia === c.id}
                  onClick={() => setCadencia(c.id)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    cadencia === c.id ? "border-primary/60 bg-primary/[0.06]" : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="block text-sm font-medium">{c.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{c.descricao}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              O limite diário de cada número e da organização vale: o que passar dele sai nos dias seguintes.
            </p>
          </fieldset>

          {!naJanela && (
            <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-[13px]" role="alert">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
              <span>
                Disparo para contato frio só sai {TEXTO_DA_JANELA}. Fora desse horário é o jeito mais rápido de perder o número.
              </span>
            </p>
          )}

          {pendencias.length > 0 && (
            <ul className="space-y-0.5 text-[13px] text-muted-foreground" aria-live="polite">
              {pendencias.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={disparar.isPending}>
            Voltar
          </Button>
          <Button onClick={confirmar} disabled={!podeConfirmar}>
            {disparar.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {disparar.isPending ? "Importando e disparando…" : `Importar e disparar ${n(selecionados)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
