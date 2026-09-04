/**
 * Edição de uma reunião já criada.
 *
 * POR QUE ESTE ARQUIVO EXISTE: até aqui a Agenda **não tinha edição nenhuma**.
 * O cabeçalho da tela dizia "Crie, edite e gerencie as atividades", mas o
 * popover de detalhe só sabia registrar comparecimento, excluir e fechar — não
 * havia um `<Input>` sequer. `useUpdateMeeting` aceitava todos os campos no
 * tipo e tinha UM único chamador, que mandava apenas `status`. A capacidade
 * existia na camada de dados e não existia na tela.
 *
 * DIFERENÇA DE FUNDO PARA O DIÁLOGO DE CRIAÇÃO: aquele ZERA o formulário toda
 * vez que abre — é o certo para criar e é exatamente o errado para editar.
 * Aqui o formulário é SEMEADO a partir da reunião carregada, e o botão de
 * salvar fica travado enquanto ela não chega. Isso não é capricho:
 * `useUpdateMeeting` faz `.update(updates)` cru, sem merge — salvar com o
 * formulário meio-semeado gravaria `null` por cima de dado bom.
 *
 * O QUE NÃO SE EDITA AQUI: participantes. Eles moram em `meeting_participants`
 * (outra tabela, com diff de inserção/remoção) e `useUpdateMeeting` não os
 * toca. Ficam preservados como estão — nenhum caminho desta tela os apaga.
 */

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useMeeting,
  useUpdateMeeting,
  type MeetingEventType,
  type UpdateMeetingInput,
} from "@/modules/engagement/hooks/useMeetings";
import { LeadPorFunilPicker } from "./LeadPorFunilPicker";

// ─── Constantes ───────────────────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS: Array<{ value: MeetingEventType; label: string }> = [
  { value: "meeting", label: "Reunião" },
  { value: "call", label: "Ligação" },
  { value: "follow_up", label: "Follow-up" },
  { value: "task", label: "Tarefa" },
  { value: "other", label: "Outro" },
];

const COLOR_OPTIONS = [
  { value: "", label: "Padrão", hex: "hsl(47, 100%, 50%)" },
  { value: "#10B981", label: "Emerald", hex: "#10B981" },
  { value: "#3B82F6", label: "Blue", hex: "#3B82F6" },
  { value: "#8B5CF6", label: "Violet", hex: "#8B5CF6" },
  { value: "#EC4899", label: "Pink", hex: "#EC4899" },
  { value: "#F97316", label: "Orange", hex: "#F97316" },
  { value: "#06B6D4", label: "Cyan", hex: "#06B6D4" },
  { value: "#E67C73", label: "Flamingo", hex: "#E67C73" },
  { value: "#D50000", label: "Red", hex: "#D50000" },
];

/** `datetime-local` não aceita offset — o input quer hora local sem fuso. */
const INPUT_DATETIME = "yyyy-MM-dd'T'HH:mm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditMeetingDialogProps {
  /** `null` mantém o diálogo fechado. */
  meetingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  event_type: MeetingEventType;
  pipeline_id: string;
  lead_id: string;
  /** Negócio da reunião. Ver a semeadura abaixo — sem ela o Salvar apaga. */
  deal_id: string;
  color: string;
  meet_link: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditMeetingDialog({
  meetingId,
  open,
  onOpenChange,
}: EditMeetingDialogProps) {
  const {
    data: meeting,
    isLoading,
    isError,
  } = useMeeting(open ? meetingId : null);
  const updateMeeting = useUpdateMeeting();

  const [form, setForm] = useState<FormState | null>(null);

  /**
   * O usuário já mexeu neste formulário? Guarda a semeadura de sobrescrever
   * digitação. É `ref` e não `state` de propósito: mudar não deve re-renderizar.
   */
  const sujoRef = useRef(false);
  /** Qual reunião o formulário atual representa. */
  const semeadoDeRef = useRef<string | null>(null);

  /**
   * Semeia o formulário a partir da reunião carregada.
   *
   * 🚨 A dependência inclui `updated_at`, e não só `id`. Com só o `id`, reabrir
   * uma reunião já visitada semeava do CACHE do TanStack (gcTime de 30min) e a
   * resposta fresca do refetch — mesmo `id`, deps inalteradas — NUNCA era
   * aplicada: quem tivesse mudado o horário por outro caminho veria o valor
   * velho no formulário e o gravaria de volta por cima do novo.
   *
   * E `sujoRef` impede o outro extremo: a Agenda invalida `["meetings"]` por
   * prefixo com frequência (realtime, debounce de 2s), então sem a guarda um
   * refetch no meio da digitação apagaria o que a pessoa acabou de escrever.
   * Dado fresco só entra enquanto o formulário está intocado.
   *
   * NÃO limpa o formulário quando `open` vira false: o `DialogContent` fica
   * montado durante os ~200ms da animação de saída, e zerar ali trocaria o
   * formulário por um spinner justo enquanto ele desaparece — uma piscada em
   * todo Cancelar e todo Salvar. Quem reseta é a troca de `meetingId`.
   */
  useEffect(() => {
    if (meetingId !== semeadoDeRef.current) {
      semeadoDeRef.current = meetingId;
      sujoRef.current = false;
      setForm(null);
    }
    if (!open || !meeting || sujoRef.current) return;
    setForm({
      title: meeting.title ?? "",
      description: meeting.description ?? "",
      location: meeting.location ?? "",
      start_at: format(new Date(meeting.start_at), INPUT_DATETIME),
      end_at: format(new Date(meeting.end_at), INPUT_DATETIME),
      all_day: meeting.all_day ?? false,
      event_type: meeting.event_type ?? "meeting",
      pipeline_id: meeting.pipeline_id ?? "",
      lead_id: meeting.lead_id ?? "",
      // 🚨 SEMEAR `deal_id` é obrigatório, não simetria de estilo.
      // `useUpdateMeeting` faz `.update(updates)` CRU: `handleSubmit` monta o
      // payload a partir DESTE formulário, então um campo não semeado vai como
      // `null` e apaga o vínculo. Sem esta linha, abrir e salvar qualquer uma
      // das 642 reuniões do backfill do S3 — sem tocar em nada — desligaria a
      // reunião do negócio, e a data sumiria do card no espelho seguinte.
      deal_id: meeting.deal_id ?? "",
      color: meeting.color ?? "",
      meet_link: meeting.meet_link ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meetingId, meeting?.id, meeting?.updated_at]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    sujoRef.current = true;
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const endBeforeStart =
    !!form && !form.all_day && new Date(form.end_at) <= new Date(form.start_at);

  /**
   * 🚨 `endBeforeStart` NÃO cobre campo vazio: `<input type="datetime-local">`
   * devolve `""` quando a pessoa apaga a data para redigitar, e toda comparação
   * com `Invalid Date` é `false` — nos DOIS sentidos. Sem esta checagem o botão
   * continuava habilitado e o clique morria em
   * `new Date("").toISOString() → RangeError`, dentro de um event handler (que
   * nenhum error boundary pega): salvar virava um botão que não faz nada e não
   * explica. Mesma forma que `MergedMeetingEditor` já usa.
   */
  const dataInvalida =
    !!form &&
    (Number.isNaN(new Date(form.start_at).getTime()) ||
      Number.isNaN(new Date(form.end_at).getTime()));

  /**
   * Reunião que abriu COM lead e está sem lead na hora de salvar. Não bloqueia
   * — desvincular é uma edição legítima —, mas a tela avisa: trocar o funil
   * limpa o lead, e sem aviso a pessoa gravaria a perda do vínculo sem ver.
   */
  const vaiDesvincularLead = !!form && !!meeting?.lead_id && !form.lead_id;

  // Sem formulário semeado NÃO se grava. Ver o cabeçalho: o update é cru.
  const podeSalvar =
    !!form &&
    !!form.title.trim() &&
    !endBeforeStart &&
    !dataInvalida &&
    !isLoading &&
    !updateMeeting.isPending;

  const handleSubmit = () => {
    if (!form || !meetingId || !podeSalvar) return;

    const input: UpdateMeetingInput = {
      id: meetingId,
      title: form.title.trim(),
      description: form.description || null,
      location: form.location || null,
      start_at: new Date(form.start_at).toISOString(),
      end_at: new Date(form.end_at).toISOString(),
      all_day: form.all_day,
      event_type: form.event_type,
      lead_id: form.lead_id || null,
      // Espelha a regra da criação: funil só se houver lead.
      pipeline_id: form.lead_id ? form.pipeline_id || null : null,
      // O negócio depende do LEAD, e deliberadamente NÃO do funil.
      //
      // 🚨 Exigir `pipeline_id` aqui anularia a semeadura acima em massa, e em
      // silêncio: `meetings.pipeline_id` é opcional e mora vazia justamente nas
      // reuniões que TÊM negócio. Medido em prod (2026-09-03): das 151 que o
      // backfill da 20270926000000 preenche, 15 ficam com `pipeline_id` NULL
      // (aquele bloco escreve SÓ `deal_id`), e o `meeting-webhook` — 883 das
      // 935 reuniões de prod — não escreve `pipeline_id` em linha nenhuma,
      // embora agora resolva `deal_id`. Nenhum trigger de `public.meetings`
      // deriva a coluna.
      // Consequência do gate antigo: abrir uma dessas na Agenda, não tocar em
      // NADA e clicar Salvar mandava `deal_id: null`; o
      // `trg_meeting_espelha_no_funil` (que cobre `UPDATE OF deal_id`) via a
      // troca, chamava `fn_espelho_limpa_projecao` e a data da reunião sumia do
      // card do Negócio e do card do funil. Apagar vínculo é para quem pediu.
      //
      // O lead sozinho basta como guarda porque `LeadPorFunilPicker` zera
      // `dealId` junto com `leadId` nos TRÊS handlers: trocar de funil, trocar
      // de lead ou limpar o lead nunca deixa um negócio de outro funil no
      // formulário. Desvincular o lead continua SOLTANDO o negócio junto — e é
      // aí, e só aí, que o espelho limpa a projeção da entrada antiga.
      deal_id: form.lead_id ? form.deal_id || null : null,
      color: form.color || null,
      meet_link: form.meet_link || null,
    };

    updateMeeting.mutate(input, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
              <Pencil className="h-3.5 w-3.5 text-primary" />
            </div>
            Editar evento
          </DialogTitle>
        </DialogHeader>

        {/* 🚨 A ordem importa: `!form` ANTES de `isError`.
            No TanStack v5 uma falha de REFETCH em background põe
            `status: 'error'` mas PRESERVA o `data` anterior. Testando `isError`
            primeiro, um erro transiente de rede — com o formulário cheio e a
            pessoa no meio de escrever — trocava tudo pela tela de erro e
            jogava a digitação fora. Erro só substitui a tela quando não há
            formulário para preservar. */}
        {!form ? (
          isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar este evento.
            </p>
          ) : (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )
        ) : (
          <div className="space-y-4 pt-1">
            {/* Título */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-meeting-title"
                className="text-xs text-muted-foreground"
              >
                Título *
              </Label>
              <Input
                id="edit-meeting-title"
                placeholder="Nome do evento"
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                autoFocus
              />
            </div>

            {/* Tipo */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo</Label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update("event_type", opt.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-all ${
                      form.event_type === opt.value
                        ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dia todo + datas */}
            <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
              <Label className="flex-1 text-xs text-muted-foreground">
                Dia todo
              </Label>
              <Switch
                checked={form.all_day}
                onCheckedChange={(v) => update("all_day", v)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="edit-meeting-start"
                  className="text-xs text-muted-foreground"
                >
                  Início *
                </Label>
                <Input
                  id="edit-meeting-start"
                  type={form.all_day ? "date" : "datetime-local"}
                  value={
                    form.all_day ? form.start_at.split("T")[0] : form.start_at
                  }
                  onChange={(e) =>
                    update(
                      "start_at",
                      form.all_day ? `${e.target.value}T00:00` : e.target.value,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="edit-meeting-end"
                  className="text-xs text-muted-foreground"
                >
                  Fim *
                </Label>
                <Input
                  id="edit-meeting-end"
                  type={form.all_day ? "date" : "datetime-local"}
                  value={form.all_day ? form.end_at.split("T")[0] : form.end_at}
                  onChange={(e) =>
                    update(
                      "end_at",
                      form.all_day ? `${e.target.value}T23:59` : e.target.value,
                    )
                  }
                />
              </div>
            </div>
            {dataInvalida ? (
              <p className="text-[11px] text-destructive">
                Informe início e fim
              </p>
            ) : endBeforeStart ? (
              <p className="text-[11px] text-destructive">
                Fim deve ser depois do início
              </p>
            ) : null}

            {/* Local */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Local</Label>
              <Input
                placeholder="Endereço ou link"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
              />
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Descrição</Label>
              <Textarea
                placeholder="Notas sobre o evento..."
                rows={3}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </div>

            {/* Funil → Lead */}
            <LeadPorFunilPicker
              value={{
                pipelineId: form.pipeline_id || null,
                leadId: form.lead_id || null,
                dealId: form.deal_id || null,
              }}
              onChange={({ pipelineId, leadId, dealId }) => {
                // O picker não passa por `update()`, então precisa marcar sujo
                // por conta própria — senão o próximo refetch em background
                // (a Agenda invalida `["meetings"]` por prefixo o tempo todo)
                // re-semeia o formulário e desfaz a escolha de funil/lead/
                // negócio que a pessoa acabou de fazer, sem aviso.
                sujoRef.current = true;
                setForm((prev) =>
                  prev
                    ? {
                        ...prev,
                        pipeline_id: pipelineId ?? "",
                        lead_id: leadId ?? "",
                        deal_id: dealId ?? "",
                      }
                    : prev,
                );
              }}
            />

            {/* Cor */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cor</Label>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {COLOR_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => update("color", opt.value)}
                    title={opt.label}
                    className={`h-5 w-5 flex-shrink-0 rounded-full border-2 transition-all ${
                      form.color === opt.value
                        ? "scale-125 border-foreground shadow-sm"
                        : "border-transparent hover:scale-110"
                    }`}
                    style={{ backgroundColor: opt.hex }}
                  />
                ))}
              </div>
            </div>

            {/* Link */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Link da reunião (Meet / Zoom / etc)
              </Label>
              <Input
                placeholder="https://meet.google.com/..."
                value={form.meet_link}
                onChange={(e) => update("meet_link", e.target.value)}
              />
            </div>

            {/* Aviso de desvínculo — não bloqueia, mas não deixa passar calado */}
            {vaiDesvincularLead && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                Ao salvar, esta reunião deixará de estar vinculada ao lead que
                tinha. Escolha um lead no funil novo se não quiser perder o
                vínculo.
              </p>
            )}

            {/* Ações */}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={updateMeeting.isPending}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={!podeSalvar}>
                {updateMeeting.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
