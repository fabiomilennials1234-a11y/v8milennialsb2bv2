/**
 * LossReasonGate — a porta ÚNICA do motivo da perda (SCRUM-369, ampliado em
 * 2026-10-09).
 *
 * Requisito travado: toda movimentação HUMANA para etapa de perda, em qualquer
 * tela, pede o motivo antes de escrever — não só o arrastar do `/funil`. Antes
 * eram nove portas e só uma perguntava; a métrica de motivos nascia vazia por
 * todas as outras.
 *
 * Forma: um provider montado UMA vez no shell (`App.tsx`) e um hook que devolve
 * `requestLossReason(pedido) → Promise<PerdaResolvida | null>`. `null` é
 * CANCELAR — quem chama não escreve nada. Uma promessa, e não um diálogo por
 * tela, porque o motivo é pré-condição do movimento: o call site lê de cima
 * para baixo ("pede → grava → move") em vez de espalhar o fluxo em estados.
 *
 * Mora em `leads` porque `leads` não importa `pipelines` (PipeOpsPort): daqui
 * ele serve `leads`, `pipelines` (o `/funil`) e `communication` (o chat). O
 * catálogo chega pela porta (`usePipeOps().useLossReasons`); a regra pura
 * (obrigatório, "Outro" exige texto) é `@/contracts/pipe/perda`.
 *
 * Sem provider montado, a porta FECHA: devolve `null` (nada é escrito) e
 * avisa. Abrir o movimento sem motivo é exatamente o defeito que ela existe
 * para matar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOrganization } from "@/modules/identity";
import {
  exigeTextoLivre,
  MOTIVOS_DE_PERDA_FALLBACK,
  resolverMotivoDaPerda,
  type MotivoDePerda,
  type PerdaResolvida,
} from "@/contracts/pipe/perda";
import { usePipeOps } from "../pipe-ops";
import { LossReasonGateContext, type PedidoDeMotivoDaPerda, type RequestLossReason } from "./useLossReasonGate";

interface PedidoAberto extends PedidoDeMotivoDaPerda {
  id: number;
}

export function LossReasonGateProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<PedidoAberto | null>(null);
  const resolverRef = useRef<((perda: PerdaResolvida | null) => void) | null>(null);
  const seq = useRef(0);

  const requestLossReason = useCallback<RequestLossReason>(
    (novo = {}) =>
      new Promise<PerdaResolvida | null>((resolve) => {
        // Um diálogo por vez: um pedido novo CANCELA o anterior em vez de
        // deixá-lo pendurado — a promessa velha resolve `null` e quem a
        // esperava não escreve.
        resolverRef.current?.(null);
        resolverRef.current = resolve;
        seq.current += 1;
        setPedido({ id: seq.current, ...novo });
      }),
    [],
  );

  const concluir = useCallback((perda: PerdaResolvida | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPedido(null);
    resolve?.(perda);
  }, []);

  // Shell desmontado com o diálogo aberto (logout, troca de org): cancela.
  useEffect(
    () => () => {
      resolverRef.current?.(null);
      resolverRef.current = null;
    },
    [],
  );

  return (
    <LossReasonGateContext.Provider value={requestLossReason}>
      {children}
      {pedido && (
        <MotivoDaPerdaDialog
          key={pedido.id}
          stageName={pedido.stageName ?? null}
          quantidade={pedido.quantidade ?? 1}
          onConfirm={(perda) => concluir(perda)}
          onCancel={() => concluir(null)}
        />
      )}
    </LossReasonGateContext.Provider>
  );
}

// ── O diálogo ───────────────────────────────────────────────────────────────

interface MotivoDaPerdaDialogProps {
  stageName: string | null;
  quantidade: number;
  onConfirm: (perda: PerdaResolvida) => void;
  onCancel: () => void;
}

/**
 * Montado só enquanto há pedido aberto: a consulta do catálogo nasce aqui, não
 * no shell — ninguém paga `loss_reasons` sem estar marcando uma perda.
 */
function MotivoDaPerdaDialog({ stageName, quantidade, onConfirm, onCancel }: MotivoDaPerdaDialogProps) {
  const { useLossReasons } = usePipeOps();
  const { organizationId } = useOrganization();
  const { data: catalogo, isLoading, isError, refetch } = useLossReasons();
  const [selecionado, setSelecionado] = useState("");
  const [nota, setNota] = useState("");

  const motivos = useMemo<MotivoDePerda[]>(() => {
    // `loss_reasons` não filtra por org na query (RLS faz isso) — mas o master
    // enxerga todas. O catálogo oferecido é o da org em que ele está.
    const daOrg = (catalogo ?? []).filter(
      (r) => !organizationId || !r.organization_id || r.organization_id === organizationId,
    );
    if (daOrg.length > 0) {
      return daOrg.map((r) => ({ value: r.id, label: r.name, doCatalogo: true }));
    }
    return MOTIVOS_DE_PERDA_FALLBACK;
  }, [catalogo, organizationId]);

  // Enquanto o catálogo carrega — ou se a consulta FALHOU — o fallback NÃO
  // aparece: escolher um slug de fallback numa org com catálogo gravaria texto
  // sem `loss_reason_id`. Fallback só quando a consulta deu certo e veio vazia.
  const carregando = isLoading && !catalogo;
  const falhou = isError && !catalogo;
  const indisponivel = carregando || falhou;
  const perda = useMemo(
    () => (indisponivel ? null : resolverMotivoDaPerda(selecionado, nota, motivos)),
    [indisponivel, selecionado, nota, motivos],
  );
  const precisaDeTexto = useMemo(() => exigeTextoLivre(selecionado, motivos), [selecionado, motivos]);

  const alvo = quantidade > 1 ? `${quantidade} negócios` : "o negócio";

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent data-testid="motivo-da-perda">
        <AlertDialogHeader>
          <AlertDialogTitle>Motivo da perda</AlertDialogTitle>
          <AlertDialogDescription>
            {stageName ? (
              <>
                Mover {alvo} para <b className="font-semibold text-foreground">{stageName}</b> registra uma
                perda.{" "}
              </>
            ) : (
              <>Marcar {alvo} como perdido. </>
            )}
            Sem o motivo, a perda vira só um número — é ele que responde onde o funil está furando.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2 px-1 py-2">
          <Select value={selecionado} onValueChange={setSelecionado} disabled={indisponivel}>
            <SelectTrigger aria-label="Motivo da perda">
              <SelectValue
                placeholder={
                  carregando ? "Carregando motivos…" : falhou ? "Motivos indisponíveis" : "Selecionar motivo"
                }
              />
            </SelectTrigger>
            {!indisponivel && (
              <SelectContent>
                {motivos.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            )}
          </Select>
          {falhou && (
            <p role="alert" className="text-[12px] text-destructive">
              Não foi possível carregar os motivos de perda.{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => void refetch()}
              >
                Tentar de novo
              </button>
            </p>
          )}
          {precisaDeTexto && (
            <Textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Qual foi o motivo? (obrigatório)"
              aria-label="Descreva o motivo"
              rows={3}
              autoFocus
            />
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (perda) onConfirm(perda);
            }}
            disabled={!perda}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Confirmar perda
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
