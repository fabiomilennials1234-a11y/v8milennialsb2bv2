/**
 * LivePreviewChat — Chat de teste com simulacao automatica
 *
 * - Chat estilo WhatsApp
 * - Botao "Simular conversa" (gera 4-6 turnos automaticos)
 * - Botao "Reiniciar"
 * - Reset automatico ao mudar prompt/config (debounce 2s)
 * - Indicador "digitando..."
 * - Suporte a attachments (imagens e PDFs)
 * - Badge "KB ativa" quando agentId presente
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
  Paperclip,
  X,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ChatAttachment {
  base64: string;
  mimeType: string;
  fileName: string;
  previewUrl?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCall?: string;
  attachment?: {
    type: "image" | "pdf";
    previewUrl?: string;
    fileName: string;
  };
}

interface LivePreviewChatProps {
  systemPrompt: string;
  agentName: string;
  isProactive: boolean;
  firstMessageTemplate?: string;
  /** Key that changes when prompt/config changes — triggers reset */
  configVersion: number;
  /** Agent ID for KB injection */
  agentId?: string;
}

const ACCEPTED_FILE_TYPES = [
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
      // Remove the data URL prefix (e.g. "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function LivePreviewChat({
  systemPrompt,
  agentName,
  isProactive,
  firstMessageTemplate,
  configVersion,
  agentId,
}: LivePreviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        setPendingAttachment(null);
      }, 2000);
      prevConfigVersionRef.current = configVersion;
      return () => clearTimeout(timer);
    }
    prevConfigVersionRef.current = configVersion;
  }, [configVersion, messages.length]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
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

  const callEdgeFunction = useCallback(
    async (
      currentMessages: ChatMessage[],
      userMsg: string,
      generateFirst: boolean,
      attachment?: ChatAttachment,
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
            ...(agentId ? { agentId } : {}),
            ...(attachment ? { attachment: { base64: attachment.base64, mimeType: attachment.mimeType, fileName: attachment.fileName } } : {}),
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
      // Edge function returns HTTP 200 even on errors (Supabase SDK limitation)
      if (result?.error) throw new Error(result.error as string);

      const parts = (result?.messages as string[] | undefined) || [result?.message as string];
      if (!parts[0]) throw new Error("Resposta vazia do agente");
      return parts;
    },
    [systemPrompt, firstMessageTemplate, supabaseUrl, anonKey, agentId]
  );

  // Send user message
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

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userMessage || (msgAttachment ? `[${msgAttachment.fileName}]` : ""), attachment: msgAttachment },
    ];
    setMessages(newMessages);
    setIsSending(true);

    try {
      const parts = await callEdgeFunction(messages, userMessage || "[Arquivo enviado]", false, currentAttachment);
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
    setPendingAttachment(null);

    try {
      const leadMessages = [
        "Ola, quero saber mais sobre o servico de voces",
        "Qual o preco?",
        "E como funciona o processo?",
        "Parece interessante, posso agendar uma conversa?",
      ];

      let currentMessages: ChatMessage[] = [];

      if (isProactive) {
        const firstParts = await callEdgeFunction([], "", true);
        for (const part of firstParts) {
          currentMessages.push({ role: "assistant", content: part });
        }
        setMessages([...currentMessages]);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }

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
    setPendingAttachment(null);
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
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Live Preview
              </Badge>
              {agentId && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-300">
                  KB ativa
                </Badge>
              )}
            </div>
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

            {/* Tool call indicator */}
            {messages.some((m) => m.toolCall) &&
              messages
                .filter((m) => m.toolCall)
                .map((m, idx) => (
                  <div key={`tool-${idx}`} className="flex justify-center">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {m.toolCall}
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

      {/* Pending attachment preview */}
      {pendingAttachment && (
        <div className="px-3 pt-2 flex items-center gap-2">
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

      {/* Input */}
      <div className="flex gap-2 p-3 border-t">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={!canTest || isSending || isSimulating}
        >
          <Paperclip className="w-4 h-4" />
        </Button>
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
          disabled={(!inputValue.trim() && !pendingAttachment) || !canTest || isSending || isSimulating}
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
