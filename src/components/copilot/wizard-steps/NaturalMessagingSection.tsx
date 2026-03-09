/**
 * NaturalMessagingSection — Seção de configuração de mensagens naturais
 *
 * Quebra respostas longas do agente em múltiplas mensagens curtas no WhatsApp,
 * simulando uma conversa real. Renderizado dentro do ConversationStyleStep.
 */

import { useFormContext } from "react-hook-form";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { MessageSquareText, Feather, MessagesSquare, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { CopilotWizardData, NaturalMessagingIntensity } from "@/types/copilot";

const INTENSITY_OPTIONS: {
  value: NaturalMessagingIntensity;
  label: string;
  description: string;
  icon: typeof Feather;
  color: string;
  bgActive: string;
}[] = [
  {
    value: "suave",
    label: "Suave",
    description: "Menos quebras, mensagens maiores. Ideal para respostas mais técnicas.",
    icon: Feather,
    color: "text-emerald-500",
    bgActive: "bg-emerald-500/10 border-emerald-500/60",
  },
  {
    value: "natural",
    label: "Natural",
    description: "Equilíbrio entre fluidez e naturalidade. Funciona bem na maioria dos casos.",
    icon: MessagesSquare,
    color: "text-blue-500",
    bgActive: "bg-blue-500/10 border-blue-500/60",
  },
  {
    value: "conversacional",
    label: "Conversacional",
    description: "Máximo de quebras, mensagens bem curtas. Simula bate-papo informal.",
    icon: Zap,
    color: "text-orange-500",
    bgActive: "bg-orange-500/10 border-orange-500/60",
  },
];

export function NaturalMessagingSection() {
  const { setValue, watch, control } = useFormContext<CopilotWizardData>();

  const enabled = watch("naturalMessagingEnabled") ?? false;
  const intensity = watch("naturalMessagingIntensity") ?? "natural";

  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name="naturalMessagingEnabled"
        render={({ field }) => (
          <FormItem>
            <Card className="p-4 border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <MessageSquareText className="w-5 h-5 text-sky-600 dark:text-sky-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <FormLabel className="text-base font-semibold cursor-pointer">
                      Mensagens Naturais
                    </FormLabel>
                    <FormDescription className="mt-1">
                      Quebra respostas longas em várias mensagens curtas, simulando como uma
                      pessoa real digitaria no WhatsApp. Inclui indicador de "digitando..." entre cada mensagem.
                    </FormDescription>
                  </div>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value ?? false}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      if (checked && !intensity) {
                        setValue("naturalMessagingIntensity", "natural", { shouldDirty: true });
                      }
                    }}
                  />
                </FormControl>
              </div>
            </Card>
          </FormItem>
        )}
      />

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Intensidade</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {INTENSITY_OPTIONS.map((opt) => {
                  const isSelected = intensity === opt.value;
                  const Icon = opt.icon;
                  return (
                    <motion.button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setValue("naturalMessagingIntensity", opt.value, { shouldDirty: true })
                      }
                      className={`flex flex-col items-start gap-2 p-4 rounded-lg border-2 text-left transition-all ${
                        isSelected ? opt.bgActive : "border-muted bg-muted/20 opacity-60"
                      }`}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${isSelected ? opt.color : "text-muted-foreground"}`} />
                        <span className={`font-semibold text-sm ${isSelected ? "" : "text-muted-foreground"}`}>
                          {opt.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {opt.description}
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
