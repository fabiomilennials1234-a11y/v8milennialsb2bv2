/**
 * Step: Testar Conversa (Preview ao vivo)
 *
 * Dois modos:
 * - Reativo (sdr, qualificador, prospectador): usuário envia primeira mensagem → agente responde
 * - Proativo (followup, agendador): agente envia primeira mensagem → usuário responde como lead
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, MessageSquare, RefreshCw, Bot, User, Play } from "lucide-react";
import { generatePrompt } from "@/hooks/useCopilotPromptBuilder";
import { mapWizardDataToAgentPreview } from "@/lib/copilot/prompt-utils";
import type { CopilotWizardData } from "@/types/copilot";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Tipos de agentes que iniciam o contato (proativos) */
const PROACTIVE_TYPES = new Set(["followup", "agendador"]);

const PROACTIVE_LABELS: Record<string, string> = {
  followup: "Follow-up",
  agendador: "Confirmador de Reuniões",
};

const PROACTIVE_HINTS: Record<string, string[]> = {
  followup: ["Tudo bem, pode me lembrar mais tarde", "Ainda tenho interesse sim!", "Não tenho interesse mais"],
  agendador: ["Confirmo! Estarei lá", "Preciso remarcar", "Qual o link da reunião?"],
};

export function TestConversationStep() {
  const { watch } = useFormContext<CopilotWizardData>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const watchedData = watch();
  const templateType = watchedData.templateType || "";
  const isProactive = PROACTIVE_TYPES.has(templateType);
  const agentName = watchedData.name || "Agente";

  // Gerar system prompt a partir dos dados do form
  useEffect(() => {
    try {
      const { agent, faqs } = mapWizardDataToAgentPreview(watchedData as CopilotWizardData);
      const kanbanRules = (watchedData.kanbanRules || [])
        .filter((r: any) => !r._disabled)
        .map((r: any) => ({
          id: `kr-${r.stageName}`,
          agent_id: "preview",
          pipe_type: r.pipeType || "whatsapp",
          stage_name: r.stageName || "",
          goal: r.goal || "",
          behavior: r.behavior || "",
          allowed_actions: r.allowedActions || [],
          forbidden_actions: r.forbiddenActions || [],
          position: 0,
          created_at: new Date().toISOString(),
        }));
      const result = generatePrompt(agent, faqs, kanbanRules);
      setSystemPrompt(result?.systemPrompt || "");
    } catch {
      setSystemPrompt("");
    }
  }, [watchedData]);

  // Resetar chat quando template muda
  useEffect(() => {
    setMessages([]);
    setHasStarted(false);
    setInputValue("");
  }, [templateType]);

  // Scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canTest = systemPrompt.trim().length >= 50;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  const callEdgeFunction = useCallback(async (
    currentMessages: ChatMessage[],
    userMsg: string,
    isFirst: boolean
  ): Promise<string[]> => {
    const response = await fetch(`${supabaseUrl}/functions/v1/test-copilot-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        systemPrompt,
        messages: currentMessages.slice(-10),
        userMessage: userMsg,
        generateFirstMessage: isFirst,
      }),
    });

    let result: Record<string, unknown>;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error((result?.error as string) || `Erro HTTP ${response.status}`);

    const parts = (result?.messages as string[] | undefined) || [result?.message as string];
    if (!parts[0]) throw new Error("Resposta vazia do agente");
    return parts;
  }, [systemPrompt, supabaseUrl, anonKey]);

  /** Agentes proativos: dispara a primeira mensagem do agente */
  const handleStartProactive = async () => {
    if (isStarting || !canTest) return;
    setIsStarting(true);
    setHasStarted(true);
    try {
      const parts = await callEdgeFunction([], "", true);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 700));
        setMessages((prev) => [...prev, { role: "assistant", content: parts[i] }]);
      }
    } catch (err: any) {
      console.error("[TestConversation] Erro primeira mensagem:", err);
      toast.error("Erro ao iniciar teste", { description: err?.message });
      setHasStarted(false);
    } finally {
      setIsStarting(false);
    }
  };

  /** Agentes reativos e continuação para ambos os tipos */
  const handleSend = async () => {
    if (!inputValue.trim() || isSending || !canTest) return;

    const userMessage = inputValue.trim();
    setInputValue("");
    const updatedMessages: ChatMessage[] = [...messages, { role: "user", content: userMessage }];
    setMessages(updatedMessages);
    setIsSending(true);

    try {
      const parts = await callEdgeFunction(messages, userMessage, false);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 700));
        setMessages((prev) => [...prev, { role: "assistant", content: parts[i] }]);
      }
    } catch (err: any) {
      console.error("[TestConversation] Erro:", err);
      toast.error("Erro ao enviar mensagem", { description: err?.message || "Tente novamente." });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setHasStarted(false);
    setInputValue("");
  };

  // Sugestões de resposta (apenas para proativos após primeira mensagem)
  const proactiveHints = PROACTIVE_HINTS[templateType] || [];
  const reactiveSuggestions = ["Olá, quero saber mais", "Qual o preço?", "Como funciona?"];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-primary" />
            Testar Conversa
          </h2>
          <p className="text-muted-foreground">
            {isProactive
              ? `Este agente é proativo — ele inicia o contato. Clique em "Iniciar teste" para ver a primeira mensagem que ele enviaria.`
              : "Simule uma conversa com seu agente antes de finalizar a criação."}
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearChat}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reiniciar
          </Button>
        )}
      </div>

      {!canTest ? (
        <Card className="p-6 text-center border-dashed">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            Preencha o contexto do negócio e o objetivo do agente para habilitar o teste.
          </p>
        </Card>
      ) : (
        <>
          {/* Indicador de modo */}
          {isProactive && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-300">
                Modo proativo
              </Badge>
              <span className="text-xs text-muted-foreground">
                {PROACTIVE_LABELS[templateType] || agentName} envia a primeira mensagem — você responde como lead
              </span>
            </div>
          )}

          {/* Chat Area */}
          <Card className="flex flex-col h-96">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30 rounded-t-lg">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{agentName}</p>
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  Teste
                </Badge>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  {isProactive ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Clique abaixo para ver a primeira mensagem que o agente enviaria
                      </p>
                      <Button
                        type="button"
                        onClick={handleStartProactive}
                        disabled={isStarting}
                        className="gap-2"
                      >
                        {isStarting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        {isStarting ? "Gerando..." : "Iniciar teste"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Envie uma mensagem para começar o teste
                      </p>
                      <div className="flex flex-wrap gap-2 justify-center mt-1">
                        {reactiveSuggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className="text-xs px-3 py-1.5 rounded-full border hover:bg-muted transition-colors"
                            onClick={() => setInputValue(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Bot className="w-3.5 h-3.5 text-primary" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted rounded-bl-sm"
                        }`}
                      >
                        {msg.content}
                      </div>
                      {msg.role === "user" && (
                        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Sugestões de resposta para proativos, após primeira mensagem do agente */}
                  {isProactive && !isSending && !isStarting && messages[messages.length - 1]?.role === "assistant" && (
                    <div className="flex flex-wrap gap-1.5 justify-end pt-1">
                      {proactiveHints.map((hint) => (
                        <button
                          key={hint}
                          type="button"
                          className="text-xs px-2.5 py-1 rounded-full border hover:bg-muted transition-colors"
                          onClick={() => setInputValue(hint)}
                        >
                          {hint}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {(isSending || isStarting) && (
                <div className="flex gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input — aparece sempre para reativos; para proativos só após iniciar */}
            {(!isProactive || hasStarted) && (
              <div className="flex gap-2 p-3 border-t">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isProactive
                      ? "Responda como se fosse o lead..."
                      : "Digite uma mensagem de teste..."
                  }
                  disabled={isSending || isStarting}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isSending || isStarting}
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            )}
          </Card>

          <p className="text-xs text-muted-foreground text-center">
            Simulação usando o prompt gerado em tempo real. O comportamento real pode variar.
          </p>
        </>
      )}
    </div>
  );
}
