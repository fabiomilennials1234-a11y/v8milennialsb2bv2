import { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WORKFLOW_VARIABLES, type WorkflowVariable } from "@/types/workflow";
import { useTags, useLeadCustomFields } from "@/modules/leads";

interface VariableInserterProps {
  /** Chamado ao clicar em um chip. Insere a variável no cursor do textarea. */
  onInsert: (variable: string) => void;
}

export function VariableInserter({ onInsert }: VariableInserterProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    Sistema: true,
    Tags: true,
    "Campos Personalizados": true,
  });

  const { data: tags } = useTags();
  const { data: customFields } = useLeadCustomFields();

  // Org-real Tags and Custom Fields become clickable chips, so the author picks
  // the exact key instead of typing {{tag.X}} / {{custom.X}} by hand.
  const variables = useMemo<WorkflowVariable[]>(() => {
    const tagVars: WorkflowVariable[] = (tags || []).map((t) => ({
      key: `{{tag.${t.name}}}`,
      label: t.name,
      category: "Tags",
    }));
    const customVars: WorkflowVariable[] = (customFields || []).map((f) => ({
      key: `{{custom.${f.field_name}}}`,
      label: f.field_name,
      category: "Campos Personalizados",
    }));
    return [...WORKFLOW_VARIABLES, ...tagVars, ...customVars];
  }, [tags, customFields]);

  const CATEGORIES = useMemo(
    () => Array.from(new Set(variables.map((v) => v.category))),
    [variables],
  );

  const filtered = variables.filter(
    (v) =>
      !search ||
      v.label.toLowerCase().includes(search.toLowerCase()) ||
      v.key.toLowerCase().includes(search.toLowerCase()),
  );

  const byCategory = CATEGORIES.map((cat) => ({
    category: cat,
    variables: filtered.filter((v) => v.category === cat),
  })).filter((g) => g.variables.length > 0);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="rounded-md border bg-muted/20 p-2 space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar variável..."
          className="h-7 pl-7 text-xs"
        />
      </div>

      <div className="space-y-0.5 max-h-44 overflow-y-auto pr-0.5">
        {byCategory.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Nenhuma variável encontrada
          </p>
        )}
        {byCategory.map(({ category, variables }) => (
          <div key={category}>
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-full py-0.5 hover:text-foreground transition-colors"
            >
              {collapsed[category] ? (
                <ChevronRight className="w-3 h-3 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 flex-shrink-0" />
              )}
              {category}
            </button>
            {!collapsed[category] && (
              <div className="flex flex-wrap gap-1 pl-4 pb-1">
                {variables.map((variable) => (
                  <Badge
                    key={variable.key}
                    variant="secondary"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs py-0 h-5 select-none"
                    title={`Clique para inserir ${variable.key}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", variable.key);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onInsert(variable.key)}
                  >
                    {variable.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Clique para inserir no cursor · Arraste para o texto
      </p>
    </div>
  );
}
