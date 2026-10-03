/**
 * ContextPanelTabInfo — aba INFOS do ContextPanel.
 *
 * Escopo (definido pelo CTO em 2026-04-23):
 *   1. Campos padrão do sistema (editáveis inline)
 *   2. Campos personalizados (+ CTA criar)
 *   3. Notas (lista + composer)
 *
 * Nada além disso. Sem Jornada, Copilot toggle ou CTA ficha — residem em
 * outros lugares do produto.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tables } from "@/integrations/supabase/types";
import {
  AtSign,
  Check,
  Copy,
  FileText,
  GitBranch,
  Loader2,
  Phone,
  Plus,
  Sparkles,
  Tag as TagIcon,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeadContactModal } from "@/modules/communication/components/chat/LeadContactModal";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateLead } from "@/modules/leads";
import { useResponsibleMembers } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { LeadCustomFields } from "@/modules/leads";
import { AddCustomFieldPopover } from "@/modules/leads";
import {
  ResponsibleSlot,
  QualificationSlot,
  type QualificationTier,
} from "@/modules/leads";
import { memberById, memberName, tierLabel } from "./contextPanelInfoHelpers";
import { ContextPanelFunnels } from "./ContextPanelFunnels";
import { telefoneParaExibicao } from "@/modules/communication/lib/identificadorOculto";

const SOURCE_OPTIONS: Array<{ value: string; label: string; dot: string }> = [
  { value: "whatsapp", label: "WhatsApp", dot: "hsl(142 71% 45%)" },
  { value: "meta_ads", label: "Meta Ads", dot: "hsl(262 62% 66%)" },
  { value: "google_ads", label: "Google Ads", dot: "hsl(358 72% 60%)" },
  { value: "instagram", label: "Instagram", dot: "hsl(320 70% 65%)" },
  { value: "site", label: "Site", dot: "hsl(212 86% 64%)" },
  { value: "landing_page", label: "Landing Page", dot: "hsl(200 86% 60%)" },
  { value: "remarketing", label: "Remarketing", dot: "hsl(30 96% 58%)" },
  { value: "indicacao", label: "Indicação", dot: "hsl(152 65% 48%)" },
  { value: "evento", label: "Evento", dot: "hsl(280 65% 68%)" },
  { value: "prospeccao_ativa", label: "Prospecção Ativa", dot: "hsl(18 85% 60%)" },
  { value: "cal", label: "Calendário", dot: "hsl(212 86% 64%)" },
  { value: "outro", label: "Outro", dot: "hsl(var(--muted-foreground))" },
];

/**
 * Forma DERIVADA de `leads`, não redeclarada.
 *
 * A versão anterior escrevia catorze campos à mão, todos opcionais. Enquanto os
 * tipos eram frouxos isso passava; com os gerados de prod, atribuir a linha real
 * a esta forma parou de compilar (TS2322) porque campos declarados aqui como
 * `string | null` são de outro tipo na tabela.
 *
 * `Partial<Pick<...>>` mantém o que este painel precisa — tudo opcional, porque
 * ele também recebe leads parciais vindos do chat — e passa a acompanhar a
 * tabela sozinho. `responsible` e `lead_tags` continuam à mão: são JOINs, não
 * colunas, e não existem em `Tables<"leads">`.
 */
type LeadShape = Partial<
  Pick<
    Tables<"leads">,
    | "id"
    | "email"
    | "phone"
    | "origin"
    | "responsible_id"
    | "organization_id"
    | "updated_at"
    | "pre_sale_responsible_id"
    | "sale_responsible_id"
    | "qualification_tier"
    | "pre_qualification_tier"
  >
> & {
  responsible?: { id?: string; name?: string } | null;
  /**
   * `lead_tags(tag:tags(id, name, color))`.
   *
   * A forma da tag é DERIVADA de `tags`, não escrita à mão — foi a mão que
   * causou o TS2322 daqui: declarava `color: string`, e **`tags.color` é
   * `string | null`** no schema. Errei o diagnóstico duas vezes antes de olhar
   * a coluna (apostei em `name` do `team_members`, que é não-nulo, e no embed
   * nulo). A lição é a mesma dos outros sete: não redeclarar forma de tabela.
   *
   * `tag` continua podendo ser nulo — embed do PostgREST só é garantido com
   * `!inner` —, e o nulo é filtrado no consumo.
   */
  lead_tags?: Array<{ tag: Pick<Tables<"tags">, "id" | "name" | "color"> | null }> | null;
};

export interface ContextPanelTabInfoProps {
  lead: LeadShape | null | undefined;
  activeLeadId: string | null;
  phoneNumber?: string;
}

export function ContextPanelTabInfo({
  lead,
  activeLeadId,
  phoneNumber,
}: ContextPanelTabInfoProps) {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  if (!lead && phoneNumber) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground mb-1">Nenhum lead vinculado a</p>
        <p className="text-sm font-medium tabular-nums">
          {telefoneParaExibicao(phoneNumber)}
        </p>

        {/*
          A AÇÃO, e não só o diagnóstico.

          Este painel dizia o que FALTA e não oferecia como resolver: o único
          caminho era descobrir que clicar no nome do contato, lá no cabeçalho,
          abre a ficha. Quem não sabia disso lia "nenhum lead vinculado" como
          estado permanente.

          Mesmo componente que o resto do produto usa para criar e vincular por
          telefone (`LeadDetailContent`, dentro de `LeadContactModal`) — a ficha
          decide entre criar e vincular a partir do que acha pelo número.
        */}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-8 text-xs"
          onClick={() => setLeadModalOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Criar ou vincular lead
        </Button>

        <LeadContactModal
          isOpen={leadModalOpen}
          onClose={() => setLeadModalOpen(false)}
          phoneNumber={phoneNumber}
        />
      </div>
    );
  }

  if (!lead || !activeLeadId) return null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        <SectionHeader icon={User} label="Campos padrão do sistema" />
        <StandardFields lead={lead} />

        <SectionHeader icon={GitBranch} label="Funis do lead" />
        <div className="px-4 pb-4">
          <ContextPanelFunnels leadId={activeLeadId} />
        </div>

        <SectionHeader icon={Sparkles} label="Campos personalizados" />
        <CustomFieldsBlock leadId={activeLeadId} />

        <SectionHeader icon={FileText} label="Notas" last />
        <NotesBlock leadId={activeLeadId} organizationId={lead.organization_id ?? null} />
      </div>
    </ScrollArea>
  );
}

/* ─── Section header ─────────────────────────────────────────────────────── */

function SectionHeader({
  icon: Icon,
  label,
  last,
}: {
  icon: typeof User;
  label: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-4 pt-4 pb-2.5",
        !last && "border-t border-border/40 first:border-t-0",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted-foreground/70">
        <Icon className="w-3 h-3" />
        {label}
      </p>
    </div>
  );
}

/* ─── Campos padrão ──────────────────────────────────────────────────────── */

function StandardFields({ lead }: { lead: LeadShape }) {
  const { mutate: updateLead, isPending: saving } = useUpdateLead();
  const responsibleMembers = useResponsibleMembers();
  const leadId = lead.id ?? null;

  const save = (patch: Record<string, unknown>) => {
    if (!lead.id) return;
    updateLead(
      { id: lead.id, ...patch } as any,
      {
        onSuccess: () => toast.success("Atualizado"),
        onError: () => toast.error("Falha ao salvar"),
      },
    );
  };

  return (
    <div className="px-4 pb-4 space-y-1">
      {/* Telefone (read-only, copy) */}
      <FieldRow label="Telefone" icon={Phone}>
        <button
          type="button"
          className="text-[13px] text-foreground tabular-nums truncate hover:text-primary transition-colors"
          onClick={() => {
            if (!lead.phone) return;
            navigator.clipboard.writeText(lead.phone);
            toast.success("Copiado");
          }}
          title="Copiar telefone"
        >
          {lead.phone || "—"}
        </button>
      </FieldRow>

      {/* E-mail (inline edit) */}
      <InlineEditText
        label="E-mail"
        icon={AtSign}
        value={lead.email ?? ""}
        placeholder="Adicionar e-mail"
        type="email"
        disabled={saving}
        onSave={(v) => save({ email: v || null })}
      />

      {/* Origem (select com dot) */}
      <FieldRow label="Origem">
        <Select
          value={lead.origin ?? ""}
          onValueChange={(v) => save({ origin: v })}
          disabled={saving}
        >
          <SelectTrigger
            className={cn(
              "h-7 gap-1.5 text-[13px] px-2",
              "border-transparent hover:border-border/60 focus:border-border",
              "bg-transparent hover:bg-muted/20",
              "transition-colors shadow-none",
            )}
          >
            <SelectValue placeholder="—">
              {lead.origin && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{
                      background: dotFor(lead.origin),
                      boxShadow: `0 0 6px ${dotFor(lead.origin)}`,
                    }}
                  />
                  {labelFor(lead.origin)}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-[13px]">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: opt.dot }}
                  />
                  {opt.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      {/* Responsáveis: Pré-venda + Vendas (modelo novo, reusa ResponsibleSlot) */}
      {leadId && (
        <>
          <FieldRow label="Pré-venda">
            <ResponsibleValue
              name={memberName(responsibleMembers, lead.pre_sale_responsible_id)}
            >
              <ResponsibleSlot
                leadId={leadId}
                field="pre_sale_responsible_id"
                label="Pré-venda"
                currentMember={memberById(responsibleMembers, lead.pre_sale_responsible_id)}
                expectedUpdatedAt={lead.updated_at ?? null}
              />
            </ResponsibleValue>
          </FieldRow>
          <FieldRow label="Vendas">
            <ResponsibleValue
              name={memberName(responsibleMembers, lead.sale_responsible_id)}
            >
              <ResponsibleSlot
                leadId={leadId}
                field="sale_responsible_id"
                label="Vendas"
                currentMember={memberById(responsibleMembers, lead.sale_responsible_id)}
                expectedUpdatedAt={lead.updated_at ?? null}
              />
            </ResponsibleValue>
          </FieldRow>
        </>
      )}

      {/* Qualificação + Pré-qualificação (reusa QualificationSlot) */}
      {leadId && (
        <>
          <FieldRow label="Pré-qualificação">
            <ResponsibleValue name={tierLabel(lead.pre_qualification_tier)}>
              <QualificationSlot
                leadId={leadId}
                field="pre_qualification_tier"
                label="Pré-qualificação"
                current={(lead.pre_qualification_tier as QualificationTier | null) ?? null}
              />
            </ResponsibleValue>
          </FieldRow>
          <FieldRow label="Qualificação">
            <ResponsibleValue name={tierLabel(lead.qualification_tier)}>
              <QualificationSlot
                leadId={leadId}
                field="qualification_tier"
                label="Qualificação"
                current={(lead.qualification_tier as QualificationTier | null) ?? null}
              />
            </ResponsibleValue>
          </FieldRow>
        </>
      )}

      {/* Tags */}
      <FieldRow label="Tags" align="start">
        <TagsEditor lead={lead} />
      </FieldRow>
    </div>
  );
}

/** Envolve um slot (avatar/ícone) com o nome/tier atual à esquerda, no padrão FieldRow. */
function ResponsibleValue({ name, children }: { name: string | null; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={cn("text-[13px] truncate", name ? "text-foreground" : "text-muted-foreground/60")}>
        {name ?? "—"}
      </span>
      {children}
    </div>
  );
}

function dotFor(value: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === value)?.dot ?? SOURCE_OPTIONS.at(-1)!.dot;
}
function labelFor(value: string): string {
  return SOURCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/* ─── FieldRow ───────────────────────────────────────────────────────────── */

function FieldRow({
  label,
  icon: Icon,
  align = "center",
  children,
}: {
  label: string;
  icon?: typeof Phone;
  align?: "center" | "start";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 py-1.5",
        align === "center" ? "items-center" : "items-start",
      )}
    >
      <span className="flex items-center gap-1.5 min-w-[88px] shrink-0 text-[11px] text-muted-foreground">
        {Icon && <Icon className="w-3 h-3 opacity-70 shrink-0" />}
        {label}
      </span>
      <div className="flex-1 min-w-0 flex justify-end">{children}</div>
    </div>
  );
}

/* ─── Inline edit text ───────────────────────────────────────────────────── */

function InlineEditText({
  label,
  icon,
  value,
  placeholder,
  type = "text",
  disabled,
  onSave,
}: {
  label: string;
  icon?: typeof Phone;
  value: string;
  placeholder: string;
  type?: "text" | "email";
  disabled?: boolean;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value.trim()) onSave(trimmed);
    setEditing(false);
  };

  return (
    <FieldRow label={label} icon={icon}>
      {editing ? (
        <Input
          autoFocus
          type={type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }}
          className="h-7 text-[13px] px-2"
          disabled={disabled}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={disabled}
          className={cn(
            "h-7 w-full text-right px-2 rounded-md border border-transparent",
            "text-[13px] text-foreground truncate",
            "hover:bg-muted/30 hover:border-border/60 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            !value && "text-muted-foreground/60 italic",
          )}
        >
          {value || placeholder}
        </button>
      )}
    </FieldRow>
  );
}

/* ─── Tags editor ────────────────────────────────────────────────────────── */

function TagsEditor({ lead }: { lead: LeadShape }) {
  const qc = useQueryClient();
  const { data: allTags = [] } = useTags();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // O `filter` não é cerimônia de tipo: embed do PostgREST vem nulo quando a
  // linha encaixada não resolve, e sem isto um `null` viraria chip sem nome.
  const current = (lead.lead_tags ?? [])
    .map((lt) => lt.tag)
    .filter((t): t is Pick<Tables<"tags">, "id" | "name" | "color"> => t !== null);

  const toggle = async (tagId: string) => {
    if (!lead.id) return;
    setBusy(tagId);
    try {
      const has = current.some((t) => t.id === tagId);
      if (has) {
        await supabase.from("lead_tags").delete().eq("lead_id", lead.id).eq("tag_id", tagId);
      } else {
        await supabase.from("lead_tags").insert({ lead_id: lead.id, tag_id: tagId });
      }
      qc.invalidateQueries({ queryKey: ["lead_by_phone"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-detail"] });
    } catch {
      toast.error("Erro ao atualizar tag");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap justify-end items-center gap-1.5 w-full">
      <AnimatePresence initial={false}>
        {current.map((t) => (
          <motion.span
            key={t.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
          >
            <Badge
              variant="outline"
              className="text-[11px] h-5 px-1.5 gap-1 group cursor-pointer"
              // `tags.color` é anulável no schema. Sem o `?? undefined`, um
              // `null` viraria a string "null20" no CSS — cor inválida, chip
              // sem estilo. `undefined` deixa o Badge usar o próprio default.
              style={{
                backgroundColor: t.color ? `${t.color}20` : undefined,
                borderColor: t.color ? `${t.color}40` : undefined,
                color: t.color ?? undefined,
              }}
              onClick={() => toggle(t.id)}
              title="Remover tag"
            >
              {t.name}
              <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-80 transition-opacity" />
            </Badge>
          </motion.span>
        ))}
      </AnimatePresence>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Adicionar tag"
            className={cn(
              "inline-flex items-center justify-center h-5 w-5 rounded-md",
              "border border-dashed border-border/60 text-muted-foreground",
              "hover:border-primary/40 hover:text-primary hover:bg-primary/5",
              "transition-colors",
            )}
          >
            <Plus className="w-3 h-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="w-60 p-2 max-h-[280px] overflow-y-auto"
          aria-label="Selecionar tags"
        >
          {allTags.length === 0 ? (
            <p className="text-[12px] text-muted-foreground px-2 py-4 text-center">
              Nenhuma tag disponível
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {allTags.map((t) => {
                const active = current.some((c) => c.id === t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    disabled={busy === t.id}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-left",
                      "hover:bg-muted/60 transition-colors",
                      "disabled:opacity-60",
                    )}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: t.color ?? undefined }}
                    />
                    <span className="flex-1 truncate text-foreground">{t.name}</span>
                    {active && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {current.length === 0 && (
        <span className="text-[11.5px] text-muted-foreground/60 italic">
          Nenhuma tag
        </span>
      )}
    </div>
  );
}

/* ─── Campos personalizados + CTA criar ─────────────────────────────────── */

function CustomFieldsBlock({ leadId }: { leadId: string }) {
  return (
    <div className="px-4 pb-4">
      <LeadCustomFields leadId={leadId} />
      <div className="mt-2">
        <AddCustomFieldPopover />
      </div>
    </div>
  );
}

/* ─── Notas (lista + composer) ───────────────────────────────────────────── */

type Note = {
  id: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
};

function useLeadNotes(leadId: string) {
  return useQuery({
    queryKey: ["lead-notes", leadId],
    queryFn: async (): Promise<Note[]> => {
      const { data, error } = await supabase
        .from("lead_history")
        .select("id, description, created_at, created_by")
        .eq("lead_id", leadId)
        .eq("action", "note_added")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Note[];
    },
    enabled: !!leadId,
    staleTime: 15_000,
  });
}

function useAddLeadNote(leadId: string, organizationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: member } = user
        ? await supabase.from("team_members").select("name").eq("user_id", user.id).maybeSingle()
        : { data: null };
      const userName = member?.name || user?.email?.split("@")[0] || "Usuário";

      const { error } = await supabase.from("lead_history").insert({
        lead_id: leadId,
        action: "note_added",
        description: `${userName}: ${text.trim()}`,
        created_by: user?.id || null,
        organization_id: organizationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-notes", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
      qc.invalidateQueries({ queryKey: ["lead-history-compact", leadId] });
    },
  });
}

function parseNote(desc: string | null): { author: string; body: string } {
  if (!desc) return { author: "—", body: "" };
  const idx = desc.indexOf(":");
  if (idx === -1) return { author: "—", body: desc };
  return { author: desc.slice(0, idx).trim(), body: desc.slice(idx + 1).trim() };
}

function NotesBlock({
  leadId,
  organizationId,
}: {
  leadId: string;
  organizationId: string | null;
}) {
  const { data: notes = [], isLoading } = useLeadNotes(leadId);
  const addNote = useAddLeadNote(leadId, organizationId);

  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    addNote.mutate(text, {
      onSuccess: () => {
        setDraft("");
        ref.current?.blur();
        setFocused(false);
      },
      onError: (err: any) => toast.error(err?.message || "Erro ao salvar nota"),
    });
  }, [draft, addNote]);

  const canSend = draft.trim().length > 0 && !addNote.isPending;
  const expanded = focused || draft.length > 0;

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Composer */}
      <div
        className={cn(
          "relative rounded-lg border transition-colors",
          expanded
            ? "border-border bg-muted/20"
            : "border-border/60 bg-transparent hover:border-border",
        )}
      >
        <Textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escreva uma nota..."
          rows={expanded ? 3 : 1}
          className={cn(
            "resize-none border-0 bg-transparent shadow-none",
            "text-[12.5px] leading-snug",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "transition-all duration-150",
          )}
        />
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="flex items-center justify-between px-2 pb-2"
            >
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                <kbd className="px-1 py-0.5 rounded border border-border/60 bg-background font-mono">
                  ⌘↵
                </kbd>{" "}
                enviar
              </span>
              <Button
                size="sm"
                onClick={send}
                disabled={!canSend}
                className="h-6 px-2.5 text-[11px] gap-1"
              >
                {addNote.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                Salvar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground/60 italic text-center py-2">
          Nenhuma nota ainda
        </p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {notes.map((note) => {
              const parsed = parseNote(note.description);
              return (
                <motion.li
                  key={note.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground mb-1">
                    <Avatar className="h-4 w-4 shrink-0">
                      <AvatarFallback className="text-[7.5px] bg-primary/15 text-primary font-bold">
                        {parsed.author.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-foreground/80">{parsed.author}</span>
                    <span className="opacity-60">·</span>
                    <time dateTime={note.created_at} className="tabular-nums">
                      {formatDistanceToNow(new Date(note.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </time>
                  </div>
                  <p className="text-[12.5px] text-foreground leading-snug whitespace-pre-wrap break-words">
                    {parsed.body}
                  </p>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
