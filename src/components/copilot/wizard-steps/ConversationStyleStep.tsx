/**
 * Step 9: Estilo de Conversa
 *
 * Define regras de humanização e estilo no WhatsApp.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle } from "lucide-react";
import type { CopilotWizardData } from "@/types/copilot";

export function ConversationStyleStep() {
  const { control } = useFormContext<CopilotWizardData>();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-millennials-yellow" />
          Estilo de Conversa
        </h2>
        <p className="text-muted-foreground">
          Ajuste o ritmo, tom natural e comportamento no WhatsApp.
        </p>
      </div>

      <div className="grid gap-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={control}
            name="conversationStyle.responseLength"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tamanho das respostas</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="curto">Curto (1–3 frases)</SelectItem>
                    <SelectItem value="medio">Médio (3–6 frases)</SelectItem>
                    <SelectItem value="detalhado">Detalhado (quando pedido)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="conversationStyle.maxQuestions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Perguntas por mensagem</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="1">Máximo 1 pergunta</SelectItem>
                    <SelectItem value="2">Até 2 perguntas</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="conversationStyle.emojiPolicy"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Uso de emojis</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="nunca">Nunca</SelectItem>
                    <SelectItem value="raro">Raro (1 no máximo)</SelectItem>
                    <SelectItem value="moderado">Moderado (se o lead usar)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={control}
            name="conversationStyle.openingStyle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Abertura preferida (opcional)</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Oi! Tudo bem? Eu sou..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="conversationStyle.closingStyle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fechamento preferido (opcional)</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: Posso te perguntar só mais uma coisa?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={control}
          name="conversationStyle.whatsappGuidelines"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Diretrizes WhatsApp (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: usar quebras de linha, evitar textos longos, responder no ritmo do lead..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>Regras específicas de comunicação.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="conversationStyle.humanizationTips"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dicas de humanização (opcional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Ex: confirmar entendimento, evitar jargões, não parecer robô..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>Instruções finas para soar mais natural.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
