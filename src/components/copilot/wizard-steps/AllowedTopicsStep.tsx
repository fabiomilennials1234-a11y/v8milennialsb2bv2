/**
 * Step 5: Tópicos Permitidos
 *
 * Lista editável de tópicos que o agente PODE discutir.
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
import { Plus, X } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function AllowedTopicsStep() {
  const { control, watch, setValue } = useFormContext<CopilotWizardData>();
  const [newTopic, setNewTopic] = useState("");
  const allowedTopics = watch("allowedTopics") || [];

  const handleAddTopic = () => {
    if (newTopic.trim() && !allowedTopics.includes(newTopic.trim())) {
      setValue("allowedTopics", [...allowedTopics, newTopic.trim()]);
      setNewTopic("");
    }
  };

  const handleRemoveTopic = (topic: string) => {
    setValue(
      "allowedTopics",
      allowedTopics.filter((t) => t !== topic)
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">O que o Agente PODE Dizer</h2>
        <p className="text-muted-foreground">
          Defina os tópicos e assuntos que o agente está autorizado a discutir
        </p>
      </div>

      <FormField
        control={control}
        name="allowedTopics"
        render={() => (
          <FormItem>
            <FormLabel>Tópicos Permitidos</FormLabel>
            <FormDescription>
              Adicione tópicos que o agente pode abordar livremente
            </FormDescription>

            <div className="flex gap-2 mt-4">
              <Input
                placeholder="Ex: Preços e orçamentos"
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

            {allowedTopics.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {allowedTopics.map((topic) => (
                  <Badge
                    key={topic}
                    variant="secondary"
                    className="text-sm py-1 px-3"
                  >
                    {topic}
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(topic)}
                      className="ml-2 hover:text-destructive"
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

      <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg">
        <p className="text-sm">
          <span className="font-semibold text-green-600">
            ✓ Tópicos Permitidos
          </span>{" "}
          - O agente pode falar livremente sobre estes assuntos sem restrições.
        </p>
      </div>
    </div>
  );
}
