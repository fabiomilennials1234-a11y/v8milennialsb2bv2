/**
 * LivePreviewChat — Chat de teste com simulacao automatica
 *
 * - Chat estilo WhatsApp
 * - Botao "Simular conversa" (gera 4-6 turnos automaticos)
 * - Botao "Reiniciar"
 * - Reset automatico ao mudar prompt/config (debounce 2s)
 * - Indicador "digitando..."
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  RefreshCw,
  Play,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCall?: string; // ex: "MOVER_CARD executada -> etapa Negociacao"
}

interface LivePreviewChatProps {
  systemPrompt: string;
  agentName: string;
  isProactive: boolean;
  firstMessageTemplate?: string;
  /** Key that changes when prompt/config changes — triggers reset */
  configVersion: number;
}

export function LivePreviewChat({
  systemPrompt,
  agentName,
  isProactive,
  firstMessageTemplate,
  configVersion,
}: LivePreviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevConfigVersionRef = useRef(configVersion);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const canTest = systemPrompt.trim().length >= 30;

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-reset when config changes (debounced)
  useEffect(() => {
    if (prevConfigVersionRef.current !== configVersion && messages.length > 0) {
      const timer = setTimeout(() => {
        setMessages([]);
        setInputValue("");
      }, 2000);
      prevConfigVersionRef.current = configVersion;
      return () => clearTimeout(timer);
    }
    prevConfigVersionRef.current = configVersion;
  }, [configVersion, messages.length]);

  const callEdgeFunction = useCallback(
    async (
      currentMessages: ChatMessage[],
      userMsg: string,
      generateFirst: boolean
    ): Promise<string[]> => {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/test-copilot-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
          body: JSON.stringify({
            systemPrompt,
            messages: currentMessages.slice(-10).map(({ role, content }) => ({ role, content })),
            userMessage: userMsg,
            generateFirstMessage: generateFirst,
            ...(generateFirst && firstMessageTemplate ? { firstMessageTemplate } : {}),
          }),
        }
      );

      let result: Record<string, unknown>;
      try {
        result = await response.json();
      } catch {
        throw new Error(`Resposta invalida (HTTP ${response.status})`);
      }
      if (!response.ok) throw new Error((result?.error as string) || `Erro HTTP ${response.status}`);

      const parts = (result?.messages as string[] | undefined) || [result?.message as string];
      if (!parts[0]) throw new Error("Resposta vazia do agente");
      return parts;
    },
    [systemPrompt, firstMessageTemplate, supabaseUrl, anonKey]
  );

  // Send user message
  const handleSend = async () => {
    if (!inputValue.trim() || isSending || !canTest) return;

    const userMessage = inputValue.trim();
    setInputValue("");
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);
    setIsSending(true);

    try {
      const parts = await callEdgeFunction(messages, userMessage, false);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 700));
        setMessages((prev) => [...prev, { role: "assistant", content: parts[i] }]);
      }
    } catch (err: any) {
      toast.error("Erro ao enviar mensagem", { description: err?.message });
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsSending(false);
    }
  };

  // Simulate full conversation
  const handleSimulate = async () => {
    if (isSimulating || !canTest) return;
    setIsSimulating(true);
    setMessages([]);

    try {
      // Pre-defined lead messages for simulation
      const leadMessages = [
        "Ola, quero saber mais sobre o servico de voces",
        "Qual o preco?",
        "E como funciona o processo?",
        "Parece interessante, posso agendar uma conversa?",
      ];

      let currentMessages: ChatMessage[] = [];

      // If proactive, agent goes first
      if (isProactive) {
        const firstParts = await callEdgeFunction([], "", true);
        for (const part of firstParts) {
          currentMessages.push({ role: "assistant", content: part });
        }
        setMessages([...currentMessages]);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }

      // Alternate lead/agent messages
      for (let i = 0; i < leadMessages.length; i++) {
        if (!isSimulating) break;

        const leadMsg = leadMessages[i];
        currentMessages.push({ role: "user", content: leadMsg });
        setMessages([...currentMessages]);
        await new Promise<void>((r) => setTimeout(r, 800));

        const agentParts = await callEdgeFunction(currentMessages, leadMsg, false);
        for (const part of agentParts) {
          currentMessages.push({ role: "assistant", content: part });
        }
        setMessages([...currentMessages]);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    } catch (err: any) {
      toast.error("Erro na simulacao", { description: err?.message });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInputValue("");
    setIsSimulating(false);
  };

  return (
    <div className="flex flex-col h-full border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 rounded-t-lg">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">{agentName || "Agente"}</p>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Live Preview
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={handleSimulate}
            disabled={!canTest || isSimulating || isSending}
          >
            {isSimulating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Simular
          </Button>
          {messages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1 text-xs"
              onClick={handleReset}
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !isSimulating ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30" />
            {!canTest ? (
              <p className="text-xs text-muted-foreground">
                Escreva o prompt do agente para habilitar o teste
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {isProactive
                    ? "Clique em Simular ou envie uma mensagem"
                    : "Envie uma mensagem como se fosse um lead"}
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                  {["Ola, quero saber mais", "Qual o preco?", "Como funciona?"].map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        className="text-[10px] px-2.5 py-1 rounded-full border hover:bg-muted transition-colors"
                        onClick={() => setInputValue(s)}
                      >
                        {s}
                      </button>
                    )
                  )}
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
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
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

            {/* Tool call indicator */}
            {messages.some((m) => m.toolCall) &&
              messages
                .filter((m) => m.toolCall)
                .map((m, idx) => (
                  <div key={`tool-${idx}`} className="flex justify-center">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      🔧 {m.toolCall}
                    </Badge>
                  </div>
                ))}
          </>
        )}

        {/* Typing indicator */}
        {(isSending || isSimulating) && (
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

      {/* Config changed notice */}
      {prevConfigVersionRef.current !== configVersion && messages.length > 0 && (
        <div className="px-4 py-1.5 bg-yellow-50 dark:bg-yellow-950/20 border-t border-yellow-200 dark:border-yellow-800">
          <p className="text-[10px] text-yellow-600 dark:text-yellow-400 text-center">
            Configuracao alterada — conversa sera reiniciada
          </p>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 p-3 border-t">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Fale como se fosse um lead..."
          disabled={!canTest || isSending || isSimulating}
          className="flex-1 h-9 text-sm"
        />
        <Button
          type="button"
          size="icon"
          className="h-9 w-9"
          onClick={handleSend}
          disabled={!inputValue.trim() || !canTest || isSending || isSimulating}
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
