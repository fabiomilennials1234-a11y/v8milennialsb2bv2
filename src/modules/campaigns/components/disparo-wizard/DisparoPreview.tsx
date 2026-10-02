/**
 * DisparoPreview — a coluna fixa à direita do assistente de Disparos.
 *
 *  1. "Prévia · como o lead recebe": o celular com o número escolhido, a bolha
 *     resolvida (variáveis preenchidas com um EXEMPLO ilustrativo — as pessoas
 *     da prévia não são do seu público) e a troca de exemplo.
 *  2. "Vão receber N": o público congelado até aqui, a duração do plano e os
 *     três blocos Por dia · Duração · Números — os mesmos números que a
 *     Revisão vai mostrar, saídos do `planBlast` puro.
 *
 * Fica de pé em todos os passos até a Revisão: quem escolhe o público já vê
 * quanto tempo o envio leva, e quem escreve já vê a mensagem resolvida.
 */
import { useMemo, useState } from "react";
import { Paperclip, Shuffle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FocusCard, FocusTile, InkPanel } from "@/components/ui/bento";
import { planBlast } from "@/modules/campaigns/lib/blast-planning";
import { resolvePreview } from "./message-preview";
import { MOCK_PREVIEW_SAMPLES } from "./mock-disparo-data";
import { regimeDoConteudo, selectedDailyCapacity, type DisparoDraft } from "./wizard-machine";

const fmt = (n: number) => n.toLocaleString("pt-BR");

function shortDate(iso: string): string {
  try {
    return format(parseISO(iso), "EEE, dd/MM", { locale: ptBR });
  } catch {
    return iso;
  }
}

export function DisparoPreview({ draft }: { draft: DisparoDraft }) {
  const [sampleIdx, setSampleIdx] = useState(0);
  const sample = MOCK_PREVIEW_SAMPLES[sampleIdx % MOCK_PREVIEW_SAMPLES.length];

  const oficial = regimeDoConteudo(draft) === "oficial";
  const text = oficial ? draft.template?.previewText ?? "" : resolvePreview(draft.message, sample);
  const selected = draft.numbers.filter((n) => n.selected);
  const sender = selected[0]?.label ?? "Seu número";

  const capacity = selectedDailyCapacity(draft);
  const plan = useMemo(
    () =>
      planBlast({
        totalRecipients: draft.audienceCount,
        numbers: selected.map((n) => ({ id: n.id, cap: n.cap })),
        startDateIso: draft.startDateIso,
      }),
    // `selected` deriva de draft.numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.audienceCount, draft.numbers, draft.startDateIso],
  );
  const first = plan.lots[0]?.dateIso;
  const last = plan.lots[plan.lots.length - 1]?.dateIso;

  return (
    <div className="flex flex-col gap-3">
      <InkPanel
        title="Prévia"
        actions={
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-tinta-foreground">
            como o lead recebe
          </span>
        }
      >
        <div className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[.04]">
          {/* Cabeçalho do chat — o número que dispara */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-extrabold text-primary-foreground">
              {sender.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-tinta-foreground">{sender}</span>
              <span className="block text-[11px] text-tinta-muted">
                {selected.length === 0
                  ? "nenhum número escolhido"
                  : oficial
                    ? "Canal Oficial · Template"
                    : selected.length > 1
                      ? `e mais ${selected.length - 1} ${selected.length - 1 === 1 ? "número" : "números"}`
                      : "WhatsApp"}
              </span>
            </span>
          </div>
          {/* Conversa */}
          <div className="min-h-[190px] bg-background/95 px-3 py-3 [background-image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:14px_14px]">
            <p className="mx-auto mb-2.5 w-fit rounded-full bg-card px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-relevo">
              Hoje
            </p>
            <div className="mr-auto max-w-[88%] rounded-2xl rounded-tl-md bg-card px-3 py-2 text-[13px] leading-snug text-foreground shadow-relevo">
              {draft.media && (
                <span className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {draft.media.name}
                </span>
              )}
              <p className="whitespace-pre-wrap break-words">
                {text || (
                  <span className="text-muted-foreground">
                    {oficial ? "O Template escolhido aparece aqui." : "Sua mensagem aparece aqui no passo Mensagem."}
                  </span>
                )}
              </p>
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">09:00</span>
            </div>
          </div>
        </div>
        {!oficial && (
          <div className="mt-2.5 flex items-center gap-2 px-1">
            <span className="min-w-0 flex-1 truncate text-[11px] text-tinta-muted">
              Exemplo ilustrativo: {sample.nome} · {sample.empresa}
            </span>
            <button
              type="button"
              onClick={() => setSampleIdx((i) => i + 1)}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[.06] px-2.5 text-[11px] font-semibold text-tinta-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Shuffle className="h-3 w-3" />
              Outro exemplo
            </button>
          </div>
        )}
      </InkPanel>

      <FocusCard className="gap-3 p-4">
        <div>
          <p className="text-[11px] font-bold text-primary-foreground/70">Vão receber</p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[2.6rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
              {fmt(draft.audienceCount)}
            </span>
            <span className="text-sm font-bold text-primary-foreground/70">
              {draft.audienceCount === 1 ? "contato" : "contatos"}
            </span>
          </p>
          <p className="mt-1 text-[12px] font-medium text-primary-foreground/75">
            {plan.dayCount > 0 && first && last
              ? plan.dayCount === 1
                ? `Tudo num dia · ${shortDate(first)}`
                : `${plan.dayCount} dias · ${shortDate(first)} → ${shortDate(last)}`
              : draft.audienceCount === 0
                ? "Escolha o público no passo 1."
                : "Escolha um número no passo Velocidade."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <FocusTile className="p-2.5">
            <p className="text-[10.5px] font-bold text-primary-foreground/65">Por dia</p>
            <p className="mt-0.5 text-[15px] font-extrabold tabular-nums">{capacity > 0 ? fmt(capacity) : "—"}</p>
          </FocusTile>
          <FocusTile className="p-2.5">
            <p className="text-[10.5px] font-bold text-primary-foreground/65">Duração</p>
            <p className="mt-0.5 text-[15px] font-extrabold tabular-nums">
              {plan.dayCount > 0 ? `${plan.dayCount} ${plan.dayCount === 1 ? "dia" : "dias"}` : "—"}
            </p>
          </FocusTile>
          <FocusTile className="p-2.5">
            <p className="text-[10.5px] font-bold text-primary-foreground/65">Números</p>
            <p className="mt-0.5 text-[15px] font-extrabold tabular-nums">{selected.length}</p>
          </FocusTile>
        </div>
      </FocusCard>
    </div>
  );
}
