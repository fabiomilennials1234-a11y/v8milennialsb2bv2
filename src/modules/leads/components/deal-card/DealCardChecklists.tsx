import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import {
  useApplyChecklistTemplate,
  useChecklistItems,
  useChecklistTemplates,
  useCreateChecklist,
  useCreateChecklistItem,
  useDeleteChecklist,
  useDeleteChecklistItem,
  useLeadChecklists,
  useToggleChecklistItem,
  type ChecklistWithCounts,
} from "@/modules/engagement";
import { cn } from "@/lib/utils";

/**
 * A aba **Checklists** do Card do Negócio.
 *
 * ── POR QUE ELA EXISTE ────────────────────────────────────────────────────
 * O card do funil já anuncia "N atividades em aberto" — e esse número é de
 * CHECKLIST, não da tabela `activities`. Até aqui, quem clicava no card caía
 * num painel onde os checklists não existiam: nem para ler, nem para marcar.
 * O item "Checklists" do menu do card tinha o mesmo destino, e por isso parecia
 * quebrado — abria o negócio e nada mais.
 *
 * ── ESCOPO: O CHECKLIST É DO LEAD ─────────────────────────────────────────
 * `checklists` tem `lead_id` e não tem `deal_id` nem `pipeline_entry_id`. Não é
 * omissão a corrigir aqui: mudar isso é migration e decisão de modelo. Então o
 * que esta aba mostra são os checklists da PESSOA — a mesma regra que os
 * comentários já seguem no painel (`DealCardComments`), pelo mesmo motivo: o
 * histórico existente é todo por lead, e filtrar por negócio esvaziaria a tela.
 *
 * ── REALTIME ──────────────────────────────────────────────────────────────
 * `useLeadChecklists` não assina — de propósito, para não duplicar canal nas
 * telas que já assinam. Aqui a assinatura é necessária: workflow e trigger de
 * etapa aplicam checklist pelo backend, e o painel costuma ficar aberto
 * enquanto isso acontece. A aba só é montada quando escolhida, então o canal
 * não pesa nas outras.
 */
export function DealCardChecklists({ leadId }: { leadId: string | null }) {
  useRealtimeSubscription("checklists", ["checklists", "checklist_templates"]);
  useRealtimeSubscription("checklist_items", ["checklist_items", "checklists"]);

  const { data: checklists = [], isLoading } = useLeadChecklists(leadId);
  const criar = useCreateChecklist();
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  /**
   * Aberto por padrão, MENOS o que já está 100%.
   *
   * Aqui a lista é o assunto da aba — colapsar tudo faria a aba abrir mostrando
   * títulos e nenhum item para marcar. O que está pronto fecha porque não pede
   * mais nada; é a mesma regra do popover do card do funil.
   */
  const abertoPorPadrao = (c: ChecklistWithCounts) =>
    !(c.total_items > 0 && c.completed_items === c.total_items);

  const itens = checklists.reduce((s, c) => s + c.total_items, 0);
  const feitos = checklists.reduce((s, c) => s + c.completed_items, 0);
  const tudoFeito = itens > 0 && feitos === itens;

  if (!leadId) {
    return (
      <p className="rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
        Este negócio não tem lead — checklist é da pessoa.
      </p>
    );
  }

  const criarChecklist = async () => {
    const t = titulo.trim();
    if (!t) {
      setCriando(false);
      return;
    }
    try {
      const novo = await criar.mutateAsync({ title: t, lead_id: leadId });
      setTitulo("");
      setCriando(false);
      if (novo?.id) setAbertos((a) => ({ ...a, [novo.id]: true }));
    } catch {
      // toast já sai do hook
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Barra: progresso à esquerda, as duas portas de criação à direita. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12.5px] font-medium">Checklists</span>
          {itens > 0 && (
            <>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                  tudoFeito ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-foreground/70",
                )}
              >
                {feitos}/{itens}
              </span>
              <div className="h-px min-w-8 flex-1 bg-muted">
                <div
                  className={cn("h-full transition-all", tudoFeito ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${(feitos / itens) * 100}%` }}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <AplicarTemplate leadId={leadId} />
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3" />
            Novo
          </button>
        </div>
      </div>

      {criando && (
        <Input
          autoFocus
          value={titulo}
          placeholder="Título do checklist…"
          className="h-8 text-[12.5px]"
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") criarChecklist();
            if (e.key === "Escape") {
              setCriando(false);
              setTitulo("");
            }
          }}
          onBlur={criarChecklist}
        />
      )}

      {isLoading ? (
        <div className="flex flex-col gap-1">
          {["72%", "88%", "60%"].map((w) => (
            <div key={w} className="h-7 animate-pulse rounded-lg bg-muted/40" style={{ width: w }} />
          ))}
        </div>
      ) : checklists.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-8 text-center text-[12.5px] text-muted-foreground">
          Nenhum checklist neste negócio.
          <br />
          <span className="text-[11.5px] text-muted-foreground/75">
            Aplique um dos checklists da sua operação ou crie um do zero.
          </span>
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {checklists.map((c) => (
            <LinhaDoChecklist
              key={c.id}
              checklist={c}
              aberto={abertos[c.id] ?? abertoPorPadrao(c)}
              onAlternar={() =>
                setAbertos((a) => ({ ...a, [c.id]: !(a[c.id] ?? abertoPorPadrao(c)) }))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "Os checklists que temos no sistema" — os templates da org (`lead_id IS NULL`).
 *
 * `useApplyChecklistTemplate` é idempotente por `(lead_id, source_template_id)`:
 * aplicar de novo devolve o que já existe em vez de duplicar (ADR-0016).
 */
function AplicarTemplate({ leadId }: { leadId: string }) {
  const { data: templates = [] } = useChecklistTemplates();
  const aplicar = useApplyChecklistTemplate();
  const [aberto, setAberto] = useState(false);
  const [emVoo, setEmVoo] = useState<string | null>(null);

  // Sem template cadastrado o botão sumiria num popover vazio. A porta de criar
  // do zero continua ao lado.
  if (templates.length === 0) return null;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <ClipboardList className="size-3" />
          Aplicar checklist
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Checklists da operação
        </p>
        <div className="max-h-56 space-y-px overflow-y-auto">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={aplicar.isPending}
              onClick={() => {
                setEmVoo(t.id);
                aplicar.mutate(
                  { templateId: t.id, leadId },
                  {
                    onSettled: () => setEmVoo(null),
                    onSuccess: () => setAberto(false),
                  },
                );
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              {emVoo === t.id ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ClipboardList className="size-3.5 shrink-0 text-muted-foreground/70" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px]">{t.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                {t.total_items}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinhaDoChecklist({
  checklist,
  aberto,
  onAlternar,
}: {
  checklist: ChecklistWithCounts;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const { data: items = [] } = useChecklistItems(checklist.id);
  const alternarItem = useToggleChecklistItem();
  const criarItem = useCreateChecklistItem();
  const removerItem = useDeleteChecklistItem();
  const removerChecklist = useDeleteChecklist();
  const [adicionando, setAdicionando] = useState(false);
  const [titulo, setTitulo] = useState("");

  const completo = checklist.total_items > 0 && checklist.completed_items === checklist.total_items;

  const adicionarItem = async () => {
    const t = titulo.trim();
    if (!t) {
      setAdicionando(false);
      return;
    }
    try {
      await criarItem.mutateAsync({ checklist_id: checklist.id, title: t, position: items.length });
      setTitulo("");
    } catch {
      // toast já sai do hook
    }
  };

  return (
    <li className="rounded-lg border border-border/70 bg-card/40">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onAlternar}
          className="shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground"
          aria-label={aberto ? "Colapsar" : "Expandir"}
          aria-expanded={aberto}
        >
          {aberto ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px] font-medium",
            completo && "text-muted-foreground/70 line-through",
          )}
        >
          {checklist.title}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            completo ? "text-emerald-400" : "text-muted-foreground",
          )}
        >
          {checklist.completed_items}/{checklist.total_items}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
              aria-label={`Opções do checklist ${checklist.title}`}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setAdicionando(true)}>
              <Plus className="mr-2 size-3.5" /> Adicionar item
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (!window.confirm(`Remover checklist "${checklist.title}"?`)) return;
                removerChecklist.mutate(checklist.id);
              }}
            >
              <Trash2 className="mr-2 size-3.5" /> Remover checklist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {aberto && (
        <div className="px-2.5 pb-1.5 pl-7">
          <ul className="space-y-px">
            {items.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/30"
              >
                <Checkbox
                  checked={item.is_completed}
                  onCheckedChange={() =>
                    alternarItem.mutate({
                      id: item.id,
                      checklist_id: checklist.id,
                      is_completed: !item.is_completed,
                    })
                  }
                  aria-label={item.title}
                  className="size-3.5 shrink-0 rounded-[4px] data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white"
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[12px] leading-snug",
                    item.is_completed
                      ? "text-muted-foreground/60 line-through"
                      : "text-foreground/85",
                  )}
                >
                  {item.title}
                </span>
                <button
                  type="button"
                  onClick={() => removerItem.mutate(item.id)}
                  className="shrink-0 text-muted-foreground/30 opacity-0 transition-colors hover:text-destructive group-hover:opacity-100"
                  aria-label={`Remover item ${item.title}`}
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>

          {adicionando ? (
            <Input
              autoFocus
              value={titulo}
              placeholder="Novo item…"
              className="mt-1 h-7 text-[12px]"
              onChange={(e) => setTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") adicionarItem();
                if (e.key === "Escape") {
                  setAdicionando(false);
                  setTitulo("");
                }
              }}
              onBlur={adicionarItem}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdicionando(true)}
              className="mt-1 flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[11.5px] text-muted-foreground/60 transition-colors hover:bg-muted/30 hover:text-foreground"
            >
              {criarItem.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Adicionar item
            </button>
          )}
        </div>
      )}
    </li>
  );
}
