/**
 * Step 6: Tópicos Proibidos
 *
 * Lista editável de tópicos que o agente NÃO PODE discutir (regra forte).
 */

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, AlertTriangle } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function ForbiddenTopicsStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const [newTopic, setNewTopic] = useState("");
  const forbiddenTopics = watch("forbiddenTopics") || [];

  const handleAddTopic = () => {
    if (newTopic.trim() && !forbiddenTopics.includes(newTopic.trim())) {
      setValue("forbiddenTopics", [...forbiddenTopics, newTopic.trim()]);
      setNewTopic("");
    }
  };

  const handleRemoveTopic = (topic: string) => {
    setValue(
      "forbiddenTopics",
      forbiddenTopics.filter((t) => t !== topic)
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-destructive" />O que o Agente NÃO PODE Dizer
        </h2>
        <p className="text-muted-foreground">
          Defina restrições rigorosas - o agente nunca abordará estes tópicos
        </p>
      </div>

      <FormField
        control={control}
        name="forbiddenTopics"
        render={() => (
          <FormItem>
            <FormLabel>Tópicos Proibidos</FormLabel>
            <FormDescription>
              Adicione tópicos que o agente JAMAIS deve discutir
            </FormDescription>

            <div className="flex gap-2 mt-4">
              <Input
                placeholder="Ex: Informações confidenciais"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTopic();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddTopic}
                disabled={!newTopic.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {forbiddenTopics.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {forbiddenTopics.map((topic) => (
                  <Badge
                    key={topic}
                    variant="destructive"
                    className="text-sm py-1 px-3"
                  >
                    {topic}
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(topic)}
                      className="ml-2 hover:opacity-70"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <FormMessage />
          </FormItem>
        )}
      />

      <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg">
        <p className="text-sm">
          <span className="font-semibold text-destructive flex items-center gap-2">
            <X className="w-4 h-4" />
            Tópicos Proibidos
          </span>
          <span className="text-muted-foreground mt-1 block">
            Se o cliente perguntar sobre estes assuntos, o agente redirecionará
            educadamente para um humano.
          </span>
        </p>
      </div>
    </div>
  );
}
