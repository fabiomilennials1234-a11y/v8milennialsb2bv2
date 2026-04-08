/**
 * Step 15: Gatilhos de Ativação
 *
 * Define as condições (IF) que o lead precisa ter para o agente entrar em ação.
 */

import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, Plus, X, Tag, Globe, Phone, Mail } from "lucide-react";
import { useState } from "react";
import type { CopilotWizardData, TriggerCondition, TriggerOperator } from "@/types/copilot";

const ORIGINS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "Tiktok" },
  { value: "google_ads", label: "Google Ads" },
  { value: "site", label: "Site" },
  { value: "landing_page", label: "Landing Page" },
  { value: "remarketing", label: "Remarketing" },
  { value: "indicacao", label: "Indicação" },
  { value: "evento", label: "Evento" },
  { value: "prospeccao_ativa", label: "Prospecção Ativa" },
  { value: "cal", label: "Cal.com" },
  { value: "outro", label: "Outros" },
];

const OPERATORS: { value: TriggerOperator; label: string }[] = [
  { value: "=", label: "igual a" },
  { value: "!=", label: "diferente de" },
  { value: ">", label: "maior que" },
  { value: "<", label: "menor que" },
  { value: ">=", label: "maior ou igual" },
  { value: "<=", label: "menor ou igual" },
  { value: "contains", label: "contém" },
  { value: "not_contains", label: "não contém" },
];

export function ActivationTriggersStep() {
  const { control, watch, setValue, getValues } = useFormContext<CopilotWizardData>();
  const [newTag, setNewTag] = useState("");
  const [newCondition, setNewCondition] = useState<TriggerCondition>({
    field: "",
    operator: "=",
    value: "",
  });

  const tags = watch("activationTriggers.required.tags") || [];
  const origins = watch("activationTriggers.required.origins") || [];
  const optional = watch("activationTriggers.optional") || [];

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setValue("activationTriggers.required.tags", [...tags, newTag.trim()], {
        shouldValidate: true,
      });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setValue(
      "activationTriggers.required.tags",
      tags.filter((t) => t !== tag),
      { shouldValidate: true }
    );
  };

  const toggleOrigin = (origin: string) => {
    const current = origins || [];
    if (current.includes(origin)) {
      setValue(
        "activationTriggers.required.origins",
        current.filter((o) => o !== origin),
        { shouldValidate: true }
      );
    } else {
      setValue("activationTriggers.required.origins", [...current, origin], {
        shouldValidate: true,
      });
    }
  };

  const addCondition = () => {
    if (newCondition.field.trim() && newCondition.value.trim()) {
      setValue("activationTriggers.optional", [...optional, newCondition], {
        shouldValidate: true,
      });
      setNewCondition({ field: "", operator: "=", value: "" });
    }
  };

  const removeCondition = (index: number) => {
    setValue(
      "activationTriggers.optional",
      optional.filter((_, i) => i !== index),
      { shouldValidate: true }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Filter className="w-6 h-6 text-primary" />
          Gatilhos de Ativação
        </h2>
        <p className="text-muted-foreground">
          Defina as condições que um lead precisa ter para o agente entrar em ação automaticamente.
        </p>
      </div>

      {/* Tags Obrigatórias */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold">Tags Obrigatórias</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          O lead DEVE ter pelo menos UMA dessas tags para o agente atuar.
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="Ex: meta_ads, campanha_xyz"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
          />
          <Button type="button" onClick={addTag} variant="outline">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 px-3 py-1">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-1 hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          {tags.length === 0 && (
            <span className="text-sm text-muted-foreground">
              Nenhuma tag adicionada (agente não terá filtro por tag)
            </span>
          )}
        </div>
      </div>

      {/* Origens Aceitas */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-green-500" />
          <h3 className="font-semibold">Origens Aceitas</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          O lead deve vir de pelo menos UMA dessas origens.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {ORIGINS.map((origin) => (
            <label
              key={origin.value}
              className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all ${
                origins.includes(origin.value)
                  ? "border-primary bg-primary/10"
                  : "border-muted hover:border-muted-foreground/50"
              }`}
            >
              <Checkbox
                checked={origins.includes(origin.value)}
                onCheckedChange={() => toggleOrigin(origin.value)}
              />
              <span className="text-sm">{origin.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Requisitos Básicos */}
      <div className="space-y-4">
        <h3 className="font-semibold">Requisitos Básicos</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={control}
            name="activationTriggers.required.hasPhone"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 p-3 border rounded-lg">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <FormLabel className="cursor-pointer">
                    Lead deve ter telefone válido
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="activationTriggers.required.hasEmail"
            render={({ field }) => (
              <FormItem className="flex items-center gap-3 space-y-0 p-3 border rounded-lg">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <FormLabel className="cursor-pointer">
                    Lead deve ter email válido
                  </FormLabel>
                </div>
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Condições Opcionais (Campos Personalizados) */}
      <div className="space-y-4">
        <h3 className="font-semibold">Condições Opcionais (Campos Personalizados)</h3>
        <p className="text-sm text-muted-foreground">
          Adicione condições extras baseadas em campos do lead. Pelo menos UMA condição deve ser verdadeira.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <Input
            placeholder="Campo (ex: faturamento)"
            value={newCondition.field}
            onChange={(e) =>
              setNewCondition({ ...newCondition, field: e.target.value })
            }
          />
          <Select
            value={newCondition.operator}
            onValueChange={(v) =>
              setNewCondition({ ...newCondition, operator: v as TriggerOperator })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Valor (ex: 50000)"
            value={newCondition.value}
            onChange={(e) =>
              setNewCondition({ ...newCondition, value: e.target.value })
            }
          />
          <Button type="button" onClick={addCondition} variant="outline">
            <Plus className="w-4 h-4 mr-1" /> Adicionar
          </Button>
        </div>

        {optional.length > 0 && (
          <div className="space-y-2">
            {optional.map((cond, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <span className="text-sm">
                  <strong>{cond.field}</strong>{" "}
                  {OPERATORS.find((o) => o.value === cond.operator)?.label}{" "}
                  <strong>{cond.value}</strong>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCondition(idx)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resumo */}
      <div className="bg-muted/30 border rounded-lg p-4">
        <h4 className="font-semibold mb-2">📋 Resumo das Condições</h4>
        <p className="text-sm text-muted-foreground">
          O agente será ativado quando um lead:
        </p>
        <ul className="text-sm mt-2 space-y-1 list-disc list-inside">
          {tags.length > 0 && (
            <li>
              Tiver uma das tags: <strong>{tags.join(", ")}</strong>
            </li>
          )}
          {origins.length > 0 && (
            <li>
              Vier de: <strong>{origins.join(" ou ")}</strong>
            </li>
          )}
          {watch("activationTriggers.required.hasPhone") && (
            <li>Tiver telefone válido</li>
          )}
          {watch("activationTriggers.required.hasEmail") && (
            <li>Tiver email válido</li>
          )}
          {optional.length > 0 && (
            <li>
              Atender pelo menos uma condição personalizada
            </li>
          )}
          {tags.length === 0 && origins.length === 0 && optional.length === 0 && (
            <li className="text-yellow-500">
              ⚠️ Nenhuma condição definida - agente atuará em TODOS os leads
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
