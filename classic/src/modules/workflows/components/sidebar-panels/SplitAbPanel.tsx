import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { migrateSplitAbData, distributePercentages } from "@/types/workflow";
import type { SplitAbNodeData, SplitVariant } from "@/types/workflow";
import { useTags } from "@/modules/leads";

interface SplitAbPanelProps {
  data: SplitAbNodeData;
  onUpdate: (updates: Partial<SplitAbNodeData>) => void;
}

export function SplitAbPanel({ data, onUpdate }: SplitAbPanelProps) {
  const migrated = migrateSplitAbData(data as unknown as Record<string, unknown>);
  const variants = migrated.variants;

  const updateVariants = useCallback(
    (newVariants: SplitVariant[]) => {
      onUpdate({ variants: newVariants });
    },
    [onUpdate]
  );

  const handleAddVariant = useCallback(() => {
    const newId = crypto.randomUUID().slice(0, 8);
    const newCount = variants.length + 1;
    const newPercentages = distributePercentages(newCount);
    const newVariants = variants.map((v, i) => ({
      ...v,
      percentage: newPercentages[i],
    }));
    newVariants.push({
      id: newId,
      label: String.fromCharCode(65 + variants.length), // A, B, C, D...
      percentage: newPercentages[newCount - 1],
    });
    updateVariants(newVariants);
  }, [variants, updateVariants]);

  const handleRemoveVariant = useCallback(
    (index: number) => {
      if (variants.length <= 2) return; // Minimum 2 paths
      const remaining = variants.filter((_, i) => i !== index);
      const newPercentages = distributePercentages(remaining.length);
      const newVariants = remaining.map((v, i) => ({
        ...v,
        percentage: newPercentages[i],
      }));
      updateVariants(newVariants);
    },
    [variants, updateVariants]
  );

  const handleLabelChange = useCallback(
    (index: number, label: string) => {
      const newVariants = variants.map((v, i) =>
        i === index ? { ...v, label } : v
      );
      updateVariants(newVariants);
    },
    [variants, updateVariants]
  );

  const handleTagsChange = useCallback(
    (index: number, tags: string[]) => {
      const newVariants = variants.map((v, i) =>
        i === index ? { ...v, tags } : v
      );
      updateVariants(newVariants);
    },
    [variants, updateVariants]
  );

  const handlePercentageChange = useCallback(
    (index: number, raw: string) => {
      const value = Math.max(0, Math.min(100, Number(raw) || 0));
      const newVariants = [...variants];
      newVariants[index] = { ...newVariants[index], percentage: value };

      // Auto-adjust: distribute the remainder across other variants proportionally
      const othersTotal = newVariants.reduce(
        (sum, v, i) => (i === index ? sum : sum + v.percentage),
        0
      );
      const remaining = 100 - value;

      if (othersTotal > 0 && newVariants.length > 1) {
        for (let i = 0; i < newVariants.length; i++) {
          if (i === index) continue;
          const ratio = newVariants[i].percentage / othersTotal;
          newVariants[i] = {
            ...newVariants[i],
            percentage: Math.round(remaining * ratio * 100) / 100,
          };
        }
      } else if (newVariants.length > 1) {
        // Others are all 0, distribute evenly
        const each = Math.round((remaining / (newVariants.length - 1)) * 100) / 100;
        for (let i = 0; i < newVariants.length; i++) {
          if (i === index) continue;
          newVariants[i] = { ...newVariants[i], percentage: each };
        }
      }

      // Fix rounding: adjust last non-edited variant
      const totalNow = newVariants.reduce((s, v) => s + v.percentage, 0);
      const diff = Math.round((100 - totalNow) * 100) / 100;
      if (diff !== 0) {
        const lastOther = newVariants.findIndex((_, i) => i !== index);
        if (lastOther >= 0) {
          newVariants[lastOther] = {
            ...newVariants[lastOther],
            percentage: Math.round((newVariants[lastOther].percentage + diff) * 100) / 100,
          };
        }
      }

      updateVariants(newVariants);
    },
    [variants, updateVariants]
  );

  const handleRedistribute = useCallback(() => {
    const newPercentages = distributePercentages(variants.length);
    const newVariants = variants.map((v, i) => ({
      ...v,
      percentage: newPercentages[i],
    }));
    updateVariants(newVariants);
  }, [variants, updateVariants]);

  const total = Math.round(variants.reduce((s, v) => s + v.percentage, 0) * 100) / 100;
  const isValid = Math.abs(total - 100) < 0.1;

  return (
    <div className="space-y-4">
      {/* Node label */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={migrated.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Teste de abordagem"
        />
      </div>

      {/* Variants */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Caminhos ({variants.length})</Label>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleRedistribute}
          >
            Redistribuir
          </Button>
        </div>

        <div className="space-y-2">
          {variants.map((variant, index) => (
            <div
              key={variant.id}
              className="space-y-2 p-2 rounded-lg border bg-background"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={variant.label}
                  onChange={(e) => handleLabelChange(index, e.target.value)}
                  placeholder={`Caminho ${index + 1}`}
                  className="flex-1 h-8 text-sm"
                />
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={variant.percentage}
                    onChange={(e) => handlePercentageChange(index, e.target.value)}
                    min={0}
                    max={100}
                    step={1}
                    className="w-20 h-8 text-sm text-right"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => handleRemoveVariant(index)}
                  disabled={variants.length <= 2}
                  title="Remover caminho"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              <VariantTagSelector
                selected={variant.tags ?? []}
                onChange={(tags) => handleTagsChange(index, tags)}
              />
            </div>
          ))}
        </div>

        {/* Add button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleAddVariant}
        >
          <Plus className="w-4 h-4 mr-2" />
          Adicionar caminho
        </Button>
      </div>

      {/* Total indicator */}
      <div
        className={cn(
          "flex items-center justify-between p-2 rounded-lg border text-sm",
          isValid
            ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
            : "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
        )}
      >
        <span>Total</span>
        <span className="font-semibold">{total}%</span>
      </div>

      {/* Help text */}
      <div className="p-3 rounded-lg bg-pink-50 dark:bg-pink-950 border border-pink-200 dark:border-pink-800">
        <p className="text-xs text-pink-700 dark:text-pink-300">
          Divide aleatoriamente os leads entre múltiplos caminhos para testar abordagens diferentes.
          Ideal para A/B/N testing de mensagens, fluxos ou estratégias.
          Leads com uma tag vinculada a um caminho entram direto nele, ignorando o sorteio por %.
        </p>
      </div>
    </div>
  );
}

// ── Seletor de tags por caminho ───────────────────────────────────────────────

function VariantTagSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const { data: tags, isLoading, isError } = useTags();

  // Tags ainda não selecionadas neste caminho (match por nome, case-insensitive)
  const selectedLower = selected.map((t) => t.toLowerCase());
  const available = (tags ?? []).filter(
    (t) => !selectedLower.includes(t.name.toLowerCase())
  );

  const addTag = (name: string) => {
    if (selectedLower.includes(name.toLowerCase())) return;
    onChange([...selected, name]);
  };

  const removeTag = (name: string) => {
    onChange(selected.filter((t) => t.toLowerCase() !== name.toLowerCase()));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Tag className="w-3 h-3" />
        <span>Tags que entram direto neste caminho (ignora %)</span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((name) => {
            const tag = (tags ?? []).find(
              (t) => t.name.toLowerCase() === name.toLowerCase()
            );
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-md border bg-muted/50 text-xs"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: tag?.color || "#888" }}
                />
                <span className="truncate max-w-[120px]">{name}</span>
                <button
                  type="button"
                  onClick={() => removeTag(name)}
                  className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                  title="Remover tag"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {isError ? (
        <p className="text-xs text-destructive">Erro ao carregar tags.</p>
      ) : (
        <Select
          value=""
          onValueChange={(v) => addTag(v)}
          disabled={isLoading || available.length === 0}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue
              placeholder={
                isLoading
                  ? "Carregando tags..."
                  : (tags ?? []).length === 0
                    ? "Nenhuma tag na organização"
                    : available.length === 0
                      ? "Todas as tags adicionadas"
                      : "Adicionar tag..."
              }
            />
          </SelectTrigger>
          <SelectContent>
            {available.map((t) => (
              <SelectItem key={t.id} value={t.name}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color || "#888" }}
                  />
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
