import { memo, useState } from "react";
import { Plus, X, Tag as TagIcon, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTags } from "@/modules/leads/hooks/useTags";
import {
  useLeadTagsAttached,
  useAddLeadTag,
  useRemoveLeadTag,
} from "../../../../hooks/lead/useLeadTagsAttached";
import { useLogLeadAction } from "../../../../hooks/useLogLeadAction";
import { cn } from "@/lib/utils";

/**
 * Horizontal bar of tag chips in the lead modal header.
 *
 * Empty state shows "Sem tags" + add button. Up to 6 chips visible; overflow
 * collapses into a "+N mais" badge. Read-only when `editable` is false
 * (typically `gates.canManageTags.allowed === false`).
 *
 * Auto-saves on add/remove and logs Tier 2 events (`tag_added` / `tag_removed`)
 * via `useLogLeadAction`. Query invalidation handled by the underlying hooks
 * in `useLeadTagsAttached`.
 */

const MAX_VISIBLE = 6;

interface LeadTagsBarProps {
  leadId: string;
  editable: boolean;
}

export const LeadTagsBar = memo(function LeadTagsBar({
  leadId,
  editable,
}: LeadTagsBarProps) {
  const { data: attached = [], isLoading: attachedLoading } = useLeadTagsAttached(leadId);
  const { data: orgTags = [] } = useTags();
  const addLeadTag = useAddLeadTag();
  const removeLeadTag = useRemoveLeadTag();
  const logAction = useLogLeadAction();

  const [comboOpen, setComboOpen] = useState(false);
  const [search, setSearch] = useState("");

  const attachedTagIds = new Set(attached.map((a) => a.tag_id));
  const availableTags = orgTags.filter((t) => !attachedTagIds.has(t.id));
  const filteredAvailable = search.trim()
    ? availableTags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : availableTags;

  const visible = attached.slice(0, MAX_VISIBLE);
  const overflow = attached.length - visible.length;

  const handleRemove = async (leadTagId: string, tagId: string, tagName: string) => {
    try {
      await removeLeadTag.mutateAsync({ leadTagId, leadId });
      logAction({
        leadId,
        action: "tag_removed",
        description: `Tag "${tagName}" removida`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao remover tag";
      toast.error(msg);
    }
  };

  const handleAdd = async (tagId: string, tagName: string) => {
    try {
      await addLeadTag.mutateAsync({ leadId, tagId });
      logAction({
        leadId,
        action: "tag_added",
        description: `Tag "${tagName}" adicionada`,
      });
      setComboOpen(false);
      setSearch("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao adicionar tag";
      toast.error(msg);
    }
  };

  // ─── Empty state ──────────────────────────────────────────────
  if (attached.length === 0 && !attachedLoading) {
    if (!editable) {
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <TagIcon className="w-3 h-3" />
          Sem tags
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground/60">Sem tags</span>
        <AddTagButton
          comboOpen={comboOpen}
          setComboOpen={setComboOpen}
          search={search}
          setSearch={setSearch}
          options={filteredAvailable}
          onPick={handleAdd}
          isPending={addLeadTag.isPending}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {visible.map((lt) => (
        <Badge
          key={lt.id}
          variant="outline"
          className="gap-1 h-6 px-2 text-xs"
          style={{
            backgroundColor: lt.tag.color ? `${lt.tag.color}15` : undefined,
            borderColor: lt.tag.color ? `${lt.tag.color}40` : undefined,
            color: lt.tag.color ?? undefined,
          }}
        >
          <span>{lt.tag.name}</span>
          {editable && (
            <button
              type="button"
              aria-label={`Remover tag ${lt.tag.name}`}
              onClick={() => handleRemove(lt.id, lt.tag_id, lt.tag.name)}
              className={cn(
                "ml-0.5 rounded-full hover:bg-foreground/10 transition-colors",
                "focus:outline-none focus:ring-1 focus:ring-primary/40",
              )}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </Badge>
      ))}

      {overflow > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge variant="outline" className="h-6 px-2 text-xs cursor-pointer">
              +{overflow} mais
            </Badge>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 space-y-1">
            {attached.slice(MAX_VISIBLE).map((lt) => (
              <div
                key={lt.id}
                className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-muted/50"
              >
                <span className="text-xs">{lt.tag.name}</span>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remover tag ${lt.tag.name}`}
                    onClick={() => handleRemove(lt.id, lt.tag_id, lt.tag.name)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {editable && (
        <AddTagButton
          comboOpen={comboOpen}
          setComboOpen={setComboOpen}
          search={search}
          setSearch={setSearch}
          options={filteredAvailable}
          onPick={handleAdd}
          isPending={addLeadTag.isPending}
        />
      )}
    </div>
  );
});

// ─── Add button + combobox ────────────────────────────────────

interface AddTagButtonProps {
  comboOpen: boolean;
  setComboOpen: (v: boolean) => void;
  search: string;
  setSearch: (v: string) => void;
  options: Array<{ id: string; name: string; color?: string | null }>;
  onPick: (tagId: string, tagName: string) => void;
  isPending: boolean;
}

function AddTagButton({
  comboOpen,
  setComboOpen,
  search,
  setSearch,
  options,
  onPick,
  isPending,
}: AddTagButtonProps) {
  return (
    <Popover open={comboOpen} onOpenChange={setComboOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-xs rounded-full"
          disabled={isPending}
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          + Tag
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2 space-y-2">
        <Input
          autoFocus
          placeholder="Buscar tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground/60 text-center py-3">
              Nenhuma tag disponível
            </p>
          )}
          {options.map((t) => (
            <div
              key={t.id}
              role="option"
              aria-label={t.name}
              tabIndex={0}
              onClick={() => onPick(t.id, t.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onPick(t.id, t.name);
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-xs"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: t.color ?? "#888" }}
              />
              {t.name}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
