/**
 * Step: Qualificação Mínima
 *
 * Critérios livres que o agente deve descobrir durante a conversa.
 * Cada critério tem prioridade: Obrigatório (coleta primeiro) ou Opcional (coleta quando possível).
 * O usuário pode adicionar critérios personalizados ou usar sugestões rápidas.
 */

import { useState, useRef } from "react";
import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, X } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

/** Sugestões comuns — usadas como atalho, não como lista fechada */
const SUGGESTIONS = [
  "Necessidade / Dor principal",
  "Volume / Escopo",
  "Urgência / Prazo",
  "Orçamento (faixa)",
  "Decisor / Autoridade",
  "Segmento / Nicho",
  "Tamanho da empresa",
  "Número de vendedores",
  "Sistema atual / Ferramentas",
  "Região de atuação",
  "Número de funcionários",
  "Faturamento anual",
];

interface Criterion {
  id: string;
  text: string;
  priority: "required" | "optional";
}

function makeCriteria(required: string[], optional: string[]): Criterion[] {
  const req = (required || []).map((text, i) => ({
    id: `req-${i}-${text}`,
    text,
    priority: "required" as const,
  }));
  const opt = (optional || []).map((text, i) => ({
    id: `opt-${i}-${text}`,
    text,
    priority: "optional" as const,
  }));
  return [...req, ...opt];
}

export function QualificationStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();

  const requiredFields = watch("qualification.requiredFields");
  const optionalFields = watch("qualification.optionalFields");

  // Inicializa uma única vez a partir dos valores do form
  const initRef = useRef(false);
  const [criteria, setCriteria] = useState<Criterion[]>(() => {
    initRef.current = true;
    return makeCriteria(requiredFields, optionalFields);
  });

  const [inputValue, setInputValue] = useState("");

  /** Persiste a lista no form */
  const syncToForm = (list: Criterion[]) => {
    setValue(
      "qualification.requiredFields",
      list.filter((c) => c.priority === "required").map((c) => c.text),
      { shouldDirty: true }
    );
    setValue(
      "qualification.optionalFields",
      list.filter((c) => c.priority === "optional").map((c) => c.text),
      { shouldDirty: true }
    );
  };

  const addCriterion = (text: string, priority: "required" | "optional" = "required") => {
    const trimmed = text.trim();
    if (trimmed.length < 2) return;
    if (criteria.some((c) => c.text.toLowerCase() === trimmed.toLowerCase())) return;
    const next = [
      ...criteria,
      { id: `${Date.now()}-${Math.random()}`, text: trimmed, priority },
    ];
    setCriteria(next);
    syncToForm(next);
  };

  const removeCriterion = (id: string) => {
    const next = criteria.filter((c) => c.id !== id);
    setCriteria(next);
    syncToForm(next);
  };

  const togglePriority = (id: string) => {
    const next = criteria.map((c) =>
      c.id === id
        ? { ...c, priority: c.priority === "required" ? ("optional" as const) : ("required" as const) }
        : c
    );
    setCriteria(next);
    syncToForm(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCriterion(inputValue);
      setInputValue("");
    }
  };

  const suggestionsAvailable = SUGGESTIONS.filter(
    (s) => !criteria.some((c) => c.text.toLowerCase() === s.toLowerCase())
  );

  const requiredCount = criteria.filter((c) => c.priority === "required").length;
  const optionalCount = criteria.filter((c) => c.priority === "optional").length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ListChecks className="w-6 h-6 text-primary" />
          Qualificação mínima
        </h2>
        <p className="text-muted-foreground">
          Defina o que o agente deve descobrir durante a conversa. Cada critério pode ser{" "}
          <span className="font-medium text-foreground">obrigatório</span> (coleta primeiro) ou{" "}
          <span className="font-medium text-foreground">opcional</span> (coleta quando possível).
        </p>
      </div>

      {/* Adicionar critério */}
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ex: Tem equipe de vendas? | Usa qual ERP? | Faturamento mensal?"
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            addCriterion(inputValue);
            setInputValue("");
          }}
          disabled={inputValue.trim().length < 2}
        >
          <Plus className="w-4 h-4 mr-1" />
          Adicionar
        </Button>
      </div>

      {/* Sugestões rápidas */}
      {suggestionsAvailable.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Sugestões rápidas
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestionsAvailable.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addCriterion(s)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-dashed border-muted-foreground/40 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="w-3 h-3" />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista de critérios */}
      {criteria.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Seus critérios
            </p>
            <p className="text-xs text-muted-foreground">
              {requiredCount > 0 && (
                <span className="text-red-600 font-medium">{requiredCount} obrigatório{requiredCount > 1 ? "s" : ""}</span>
              )}
              {requiredCount > 0 && optionalCount > 0 && " · "}
              {optionalCount > 0 && (
                <span className="text-sky-600 font-medium">{optionalCount} opcional{optionalCount > 1 ? "is" : ""}</span>
              )}
            </p>
          </div>

          <div className="space-y-2">
            {criteria.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-card"
              >
                <span className="flex-1 text-sm">{c.text}</span>

                {/* Toggle prioridade */}
                <button
                  type="button"
                  onClick={() => togglePriority(c.id)}
                  title="Clique para alternar entre Obrigatório e Opcional"
                  className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                    c.priority === "required"
                      ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                      : "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                  }`}
                >
                  {c.priority === "required" ? "Obrigatório" : "Opcional"}
                </button>

                <button
                  type="button"
                  onClick={() => removeCriterion(c.id)}
                  className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Clique no badge para alternar entre{" "}
            <span className="text-red-600 font-medium">Obrigatório</span> e{" "}
            <span className="text-sky-600 font-medium">Opcional</span>.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed rounded-lg gap-2">
          <ListChecks className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Nenhum critério adicionado. Use as sugestões acima ou crie o seu.
          </p>
        </div>
      )}

      {/* Instruções especiais */}
      <FormField
        control={control}
        name="qualification.notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Instruções especiais (opcional)</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Ex: Não perguntar orçamento logo de cara. Priorizar urgência. Se for de SP, oferecer visita presencial..."
                rows={3}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
