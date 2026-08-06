import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useResponsibleMembers, useCurrentTeamMember, isVirtualTeamMember } from "@/modules/identity";
import { cn } from "@/lib/utils";

/**
 * "Novo negócio" — a única porta de entrada de um negócio (decisão D1).
 *
 * Depois do D1 o ingest nunca cria negócio: quem abre é uma pessoa, aqui. Por
 * isso o botão é primário e vive no cabeçalho da seção, não escondido num strip
 * de rodapé.
 *
 * **Só oferece campo que tem casa no banco.** O submit vai para a RPC
 * `abrir_negocio`, que cria identidade (`deals`) e posição (`pipeline_entries` /
 * `custom_pipe_entries`) ligadas por `deal_id`, numa transação só:
 *
 * | Campo      | Onde grava                                   | Em qual funil |
 * |------------|----------------------------------------------|---------------|
 * | Etapa      | `status` / `stage_id`                        | todos         |
 * | Dono       | `deals.owner_id` + responsável do card        | todos         |
 * | Observação | `deals.notes` + `notes` do card               | todos         |
 * | Valor      | `deals.value` + `pipe_propostas.sale_value`   | Propostas     |
 * | Reunião    | `pipe_confirmacao.meeting_date`              | Confirmação   |
 *
 * **Título não é campo daqui, e é de propósito** (ADR-0023 decisão 9). Ele nasce
 * derivado — `Negócio de <mês>/<ano>`, no fuso da org — e é editável depois.
 * Campo obrigatório aqui foi rejeitado por pôr atrito na única porta de criação;
 * campo opcional foi deixado para a tela de detalhe, onde renomear ("Reposição
 * trimestral") é a ação que o usuário já foi procurar.
 *
 * A versão anterior deste comentário dizia "título não existe, `deals.title` é da
 * fatia 2, o negócio se chama pelo nome do funil". Verdade até a fatia 2 escrever
 * esta porta — o nome do funil como título é exatamente o que a decisão 9 rejeita.
 */

export interface NewDealOption {
  /** Chave estável — o consumidor usa pra rotear a mutation correta. */
  key: string;
  label: string;
  color?: string;
  stages: { id: string; label: string }[];
  /** Propostas — habilita o campo de valor. */
  supportsValue?: boolean;
  /** Confirmação — habilita a data da reunião. */
  supportsMeeting?: boolean;
  /** Carteira e afins: entram por regra própria, não por este modal. */
  disabled?: boolean;
  disabledReason?: string;
}

export interface NewDealValues {
  stageId: string;
  ownerId: string | null;
  saleValue: number | null;
  meetingDate: string | null;
  notes: string | null;
}

interface NewDealDialogProps {
  options: NewDealOption[];
  isCreating?: boolean;
  onCreate: (option: NewDealOption, values: NewDealValues) => Promise<void>;
  size?: "sm" | "md";
  /**
   * Modo controlado — quem abre é de fora.
   *
   * Existe porque a porta de criação passou a ter dois pontos de partida: o
   * cabeçalho da seção Negócios (que usa o gatilho daqui) e o botão "Criar
   * negócio" do Card do Lead, que já é um botão desenhado, em outra árvore, e
   * não pode virar `DialogTrigger` sem arrastar Supabase para dentro do card —
   * o card é DB-free de propósito (é o que mantém `/preview.html` de pé).
   *
   * Omitido, o diálogo segue exatamente como era: estado interno + gatilho.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Sem gatilho próprio — o botão que abre vive fora. */
  hideTrigger?: boolean;
}

/** "1.234,56" e "1234.56" viram 1234.56; lixo vira null. */
function parseBRLInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const NewDealDialog = memo(function NewDealDialog({
  options,
  isCreating = false,
  onCreate,
  size = "sm",
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: NewDealDialogProps) {
  const [openInterno, setOpenInterno] = useState(false);
  const controlado = openProp !== undefined;
  const open = controlado ? openProp : openInterno;
  const setOpen = (next: boolean) => {
    if (!controlado) setOpenInterno(next);
    onOpenChange?.(next);
  };
  const [optionKey, setOptionKey] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [valueRaw, setValueRaw] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Devolve o array já filtrado por `is_active`, não um resultado de query.
  const members = useResponsibleMembers();
  const { data: currentMember } = useCurrentTeamMember();

  // Master virtual carrega id não-UUID e não pode virar FK de responsável.
  const selectableMembers = useMemo(
    () => members.filter((m) => !isVirtualTeamMember(m.id)),
    [members],
  );

  const enabled = useMemo(() => options.filter((o) => !o.disabled), [options]);
  const blocked = useMemo(() => options.filter((o) => o.disabled), [options]);
  const selected = useMemo(
    () => options.find((o) => o.key === optionKey) ?? null,
    [options, optionKey],
  );

  const limparFormulario = useCallback(() => {
    const first = enabled[0] ?? null;
    setOptionKey(first?.key ?? null);
    setStageId(first?.stages[0]?.id ?? "");
    setOwnerId(
      currentMember && !isVirtualTeamMember(currentMember.id) ? currentMember.id : "",
    );
    setValueRaw("");
    setMeetingDate("");
    setNotes("");
  }, [enabled, currentMember]);

  /**
   * Reset acontece na **transição** fechado→aberto, e só nela.
   *
   * A versão anterior amarrava o reset ao `handleOpenChange`, para fugir de um
   * efeito com `[open, enabled, currentMember]` que reexecutava a cada render em
   * que qualquer uma dessas referências fosse recriada — e aí o formulário se
   * zerava embaixo de quem estava digitando. O modo controlado quebra aquela
   * amarração: quando quem abre é o botão do Card do Lead, `handleOpenChange`
   * nunca roda, e o modal abriria sem funil escolhido — com o botão "Criar
   * negócio" morto, porque `canSubmit` exige `selected`.
   *
   * A guarda de aresta (`estavaAberto`) devolve a propriedade que interessava:
   * o efeito pode reexecutar à vontade, mas o corpo só age na borda de abertura.
   * Começa em `false` de propósito — montar já aberto (modo controlado) É uma
   * abertura.
   */
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (open && !estavaAberto.current) limparFormulario();
    estavaAberto.current = open;
  }, [open, limparFormulario]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
  };

  // Trocar de funil reposiciona a etapa — stage de um funil não existe no outro.
  const handleSelectOption = (option: NewDealOption) => {
    if (option.disabled) return;
    setOptionKey(option.key);
    setStageId(option.stages[0]?.id ?? "");
  };

  const canSubmit = Boolean(selected && stageId) && !submitting && !isCreating;

  const handleSubmit = async () => {
    if (!selected || !stageId || submitting) return;
    setSubmitting(true);
    try {
      await onCreate(selected, {
        stageId,
        ownerId: ownerId || null,
        saleValue: selected.supportsValue ? parseBRLInput(valueRaw) : null,
        meetingDate: selected.supportsMeeting && meetingDate ? meetingDate : null,
        notes: notes.trim() || null,
      });
      setOpen(false);
    } catch {
      // O consumidor já mostra o toast de erro; manter o modal aberto preserva
      // o que foi digitado pra segunda tentativa.
    } finally {
      setSubmitting(false);
    }
  };

  const noOptions = options.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={noOptions}
          data-testid="new-deal-button"
          title={noOptions ? "O lead já está em todos os funis" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-semibold",
            "border border-primary/30 bg-primary/10 text-primary",
            "hover:bg-primary/15 hover:border-primary/50",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            "disabled:opacity-45 disabled:pointer-events-none",
            size === "sm" ? "h-7 px-2.5 text-[11.5px]" : "h-9 px-3.5 text-[13px]",
          )}
        >
          <Plus className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
          Novo negócio
        </button>
      </DialogTrigger>
      )}

      <DialogContent className="max-w-lg" data-testid="new-deal-dialog">
        <DialogHeader>
          <DialogTitle>Novo negócio</DialogTitle>
          <DialogDescription>
            O negócio herda os dados do lead. Escolha onde ele entra e quem toca.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* No modo controlado o botão que abre vive fora e não sabe se sobrou
              funil — o gatilho daqui se desabilita sozinho, o de lá não pode.
              Sem esta linha o diálogo abriria vazio, que lê como quebrado. */}
          {noOptions && (
            <p
              className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground"
              data-testid="new-deal-sem-funil"
            >
              O lead já tem negócio em todos os funis.
            </p>
          )}

          {/* Funil — a escolha estruturante, então vem primeiro e em cartões. */}
          <div className="space-y-1.5">
            {!noOptions && <Label className="text-[12px] text-muted-foreground">Funil</Label>}
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Funil">
              {enabled.map((option) => {
                const active = option.key === optionKey;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleSelectOption(option)}
                    data-testid={`new-deal-option-${option.key}`}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px]",
                      "transition-colors duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/50 bg-primary/10 font-semibold text-foreground"
                        : "border-border bg-muted/20 hover:bg-muted/50",
                    )}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: option.color ?? "hsl(var(--muted-foreground))" }}
                      aria-hidden
                    />
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>

            {blocked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {blocked.map((option) => (
                  <span
                    key={option.key}
                    title={option.disabledReason}
                    className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground/70"
                  >
                    <Lock className="size-2.5" aria-hidden />
                    {option.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-deal-stage" className="text-[12px] text-muted-foreground">
                    Etapa inicial
                  </Label>
                  <Select value={stageId} onValueChange={setStageId}>
                    <SelectTrigger id="new-deal-stage" data-testid="new-deal-stage">
                      <SelectValue placeholder="Escolha a etapa" />
                    </SelectTrigger>
                    <SelectContent>
                      {selected.stages.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="new-deal-owner" className="text-[12px] text-muted-foreground">
                    Dono
                  </Label>
                  <Select value={ownerId} onValueChange={setOwnerId}>
                    <SelectTrigger id="new-deal-owner" data-testid="new-deal-owner">
                      <SelectValue placeholder="Sem dono" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {selected.supportsValue && (
                <div className="space-y-1.5">
                  <Label htmlFor="new-deal-value" className="text-[12px] text-muted-foreground">
                    Valor
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="new-deal-value"
                      data-testid="new-deal-value"
                      inputMode="decimal"
                      value={valueRaw}
                      onChange={(e) => setValueRaw(e.target.value)}
                      placeholder="0,00"
                      className="pl-9 tabular-nums"
                    />
                  </div>
                </div>
              )}

              {selected.supportsMeeting && (
                <div className="space-y-1.5">
                  <Label htmlFor="new-deal-meeting" className="text-[12px] text-muted-foreground">
                    Data da reunião
                  </Label>
                  <Input
                    id="new-deal-meeting"
                    data-testid="new-deal-meeting"
                    type="datetime-local"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Os lembretes D-5, D-3 e D-1 saem a partir desta data.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="new-deal-notes" className="text-[12px] text-muted-foreground">
                  Observação
                </Label>
                <Textarea
                  id="new-deal-notes"
                  data-testid="new-deal-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contexto que o próximo a pegar precisa saber"
                  className="resize-none"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="new-deal-submit">
            {(submitting || isCreating) && (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
            )}
            Criar negócio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
