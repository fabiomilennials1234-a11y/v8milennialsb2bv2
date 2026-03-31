/**
 * Step: Testar Conversa (Preview ao vivo)
 *
 * Dois modos:
 * - Reativo (qualificador): usuario envia primeira mensagem -> agente responde
 * - Proativo (sdr, prospectador, followup, agendador): agente envia primeira mensagem -> usuario responde como lead
 * - Suporte a attachments (imagens e PDFs)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, MessageSquare, RefreshCw, Bot, User, Play, Paperclip, X, FileText } from "lucide-react";
import { generatePrompt } from "@/hooks/useCopilotPromptBuilder";
import { mapWizardDataToAgentPreview } from "@/lib/copilot/prompt-utils";
import type { CopilotWizardData } from "@/types/copilot";

interface ChatAttachment {
  base64: string;
  mimeType: string;
  fileName: string;
  previewUrl?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachment?: {
    type: "image" | "pdf";
    previewUrl?: string;
    fileName: string;
  };
}

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Tipos de agentes que iniciam o contato (proativos) */
const PROACTIVE_TYPES = new Set(["followup", "agendador", "sdr", "prospectador"]);

const PROACTIVE_LABELS: Record<string, string> = {
  followup: "Follow-up",
  agendador: "Confirmador de Reunioes",
  sdr: "SDR Outbound",
  prospectador: "Prospectador",
};

const PROACTIVE_HINTS: Record<string, string[]> = {
  followup: ["Tudo bem, pode me lembrar mais tarde", "Ainda tenho interesse sim!", "Nao tenho interesse mais"],
  agendador: ["Confirmo! Estarei la", "Preciso remarcar", "Qual o link da reuniao?"],
  sdr: ["Oi, quem e voce?", "Me conta mais sobre isso", "Nao tenho interesse, obrigado"],
  prospectador: ["Pode me falar mais?", "Qual o preco?", "Nao estou interessado no momento"],
};

export function TestConversationStep() {
  const { watch } = useFormContext<CopilotWizardData>();
  const { id: editAgentId } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const watchedData = watch();
  const templateType = watchedData.templateType || "";
  const operationMode = watchedData.operationMode || "inbound";
  const isProactive = PROACTIVE_TYPES.has(templateType) || operationMode === "outbound" || operationMode === "hybrid";
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
    setPendingAttachment(null);
  }, [templateType]);

  // Scroll para ultima mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canTest = systemPrompt.trim().length >= 50;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  // Template de primeira mensagem para outbound/hybrid
  const firstMessageTemplate = watchedData.outboundConfig?.firstMessageTemplate || "";

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Tipo de arquivo nao suportado", {
        description: "Envie imagens (PNG, JPG, WebP, GIF) ou PDFs.",
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error("Arquivo muito grande", {
        description: "O tamanho maximo e 20MB.",
      });
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;

      setPendingAttachment({
        base64,
        mimeType: file.type,
        fileName: file.name,
        previewUrl,
      });
    } catch {
      toast.error("Erro ao ler arquivo");
    }
  }, []);

  const callEdgeFunction = useCallback(async (
    currentMessages: ChatMessage[],
    userMsg: string,
    isFirst: boolean,
    attachment?: ChatAttachment,
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
        messages: currentMessages.slice(-10).map(({ role, content }) => ({ role, content })),
        userMessage: userMsg,
        generateFirstMessage: isFirst,
        ...(isFirst && firstMessageTemplate ? { firstMessageTemplate } : {}),
        ...(editAgentId ? { agentId: editAgentId } : {}),
        ...(attachment ? { attachment: { base64: attachment.base64, mimeType: attachment.mimeType, fileName: attachment.fileName } } : {}),
      }),
    });

    let result: Record<string, unknown>;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Resposta invalida do servidor (HTTP ${response.status})`);
    }
    if (!response.ok) throw new Error((result?.error as string) || `Erro HTTP ${response.status}`);

    const parts = (result?.messages as string[] | undefined) || [result?.message as string];
    if (!parts[0]) throw new Error("Resposta vazia do agente");
    return parts;
  }, [systemPrompt, firstMessageTemplate, supabaseUrl, anonKey, editAgentId]);

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

  /** Agentes reativos e continuacao para ambos os tipos */
  const handleSend = async () => {
    if ((!inputValue.trim() && !pendingAttachment) || isSending || !canTest) return;

    const userMessage = inputValue.trim();
    setInputValue("");

    const msgAttachment = pendingAttachment
      ? {
          type: (pendingAttachment.mimeType.startsWith("image/") ? "image" : "pdf") as "image" | "pdf",
          previewUrl: pendingAttachment.previewUrl,
          fileName: pendingAttachment.fileName,
        }
      : undefined;

    const currentAttachment = pendingAttachment || undefined;
    setPendingAttachment(null);

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMessage || (msgAttachment ? `[${msgAttachment.fileName}]` : ""), attachment: msgAttachment },
    ];
    setMessages(updatedMessages);
    setIsSending(true);

    try {
      const parts = await callEdgeFunction(messages, userMessage || "[Arquivo enviado]", false, currentAttachment);
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
    setPendingAttachment(null);
  };

  // Sugestoes de resposta (apenas para proativos apos primeira mensagem)
  const proactiveHints = PROACTIVE_HINTS[templateType] || [];
  const reactiveSuggestions = ["Ola, quero saber mais", "Qual o preco?", "Como funciona?"];

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
              ? `Este agente e proativo — ele inicia o contato. Clique em "Iniciar teste" para ver a primeira mensagem que ele enviaria.`
              : "Simule uma conversa com seu agente antes de finalizar a criacao."}
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
            Preencha o contexto do negocio e o objetivo do agente para habilitar o teste.
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
                {PROACTIVE_LABELS[templateType] || agentName} envia a primeira mensagem — voce responde como lead
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
                        Envie uma mensagem para comecar o teste
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
                        {/* Attachment preview in message */}
                        {msg.attachment && msg.attachment.type === "image" && msg.attachment.previewUrl && (
                          <img
                            src={msg.attachment.previewUrl}
                            alt={msg.attachment.fileName}
                            className="max-w-[200px] max-h-[150px] rounded-lg mb-1 object-cover"
                          />
                        )}
                        {msg.attachment && msg.attachment.type === "pdf" && (
                          <div className="flex items-center gap-1.5 mb-1 px-2 py-1 rounded bg-black/10 text-xs">
                            <FileText className="w-3.5 h-3.5" />
                            {msg.attachment.fileName}
                          </div>
                        )}
                        {msg.content}
                      </div>
                      {msg.role === "user" && (
                        <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Sugestoes de resposta para proativos, apos primeira mensagem do agente */}
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

            {/* Pending attachment preview */}
            {pendingAttachment && (
              <div className="px-3 pt-2 flex items-center gap-2 border-t">
                {pendingAttachment.mimeType.startsWith("image/") && pendingAttachment.previewUrl ? (
                  <img
                    src={pendingAttachment.previewUrl}
                    alt={pendingAttachment.fileName}
                    className="w-12 h-12 rounded object-cover border"
                  />
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border bg-muted text-xs">
                    <FileText className="w-3.5 h-3.5" />
                    {pendingAttachment.fileName}
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    if (pendingAttachment.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
                    setPendingAttachment(null);
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* Input — aparece sempre para reativos; para proativos so apos iniciar */}
            {(!isProactive || hasStarted) && (
              <div className="flex gap-2 p-3 border-t">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES.join(",")}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSending || isStarting}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
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
                  disabled={(!inputValue.trim() && !pendingAttachment) || isSending || isStarting}
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
            Simulacao usando o prompt gerado em tempo real. O comportamento real pode variar.
          </p>
        </>
      )}
    </div>
  );
}
