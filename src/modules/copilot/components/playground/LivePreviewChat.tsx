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

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  Image,
  Video,
  File,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { PlaygroundToolState } from "./types";
import { buildPreviewTools, buildSendDocumentTool, type DryRunToolCall } from "@/lib/copilot/dry-run-engine";
import { useAgentDocuments } from "../../hooks/useAgentDocuments";

/**
 * Descrição do card de ferramenta no preview.
 *
 * Para `send_document`, troca o UUID cru pelo NOME do arquivo — sem isso não dá
 * pra conferir na tela se saiu a foto certa, que é justamente o que se quer
 * validar. Se o id não casar com nenhum documento da KB, diz isso em vez de
 * imprimir o valor bruto: em produção esse caso não envia nada.
 */
function describeToolCall(
  tc: DryRunToolCall,
  documents: { id: string; file_name: string }[] | undefined,
): string {
  if (tc.name !== "send_document") return tc.humanDescription;
  const id = String(tc.parameters?.document_id ?? "");
  const doc = documents?.find((d) => d.id === id);
  const caption = tc.parameters?.caption ? ` (${tc.parameters.caption})` : "";
  if (doc) return `ENVIAR_DOCUMENTO → ${doc.file_name}${caption}`;
  return `ENVIAR_DOCUMENTO → ⚠️ id não encontrado na base ("${id.slice(0, 60)}") — nada seria enviado`;
}

/** Frases de lead para começar o teste — atalho, não conteúdo do agente. */
const PREVIEW_SUGGESTIONS = ["Olá, quero saber mais", "Qual o preço?", "Como funciona?"];

// ─── Media card in message bubbles ─────────────────────

const MEDIA_PATTERN = /\[(video|imagem|documento|image|doc)\]\s*(.+?)(?:\n|$)/gi;

function MediaCard({ type, fileName }: { type: string; fileName: string }) {
  const t = type.toLowerCase();
  const isVideo = t === "video";
  const isImage = t === "imagem" || t === "image";

  const Icon = isVideo ? Video : isImage ? Image : File;
  const label = isVideo ? "Vídeo" : isImage ? "Imagem" : "Documento";
  const color = isVideo
    ? "bg-insights/10 text-insights border-insights/20"
    : isImage
    ? "bg-primary-soft text-primary-soft-foreground border-primary/20"
    : "bg-muted text-foreground/70 border-border";

  return (
    <div className={`my-1 flex items-center gap-2.5 rounded-xl border px-3 py-2 ${color}`}>
      <div className="p-1.5 rounded-md bg-foreground/10">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{fileName.trim()}</p>
        <p className="text-[10px] opacity-70">{label} enviado</p>
      </div>
    </div>
  );
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser || !MEDIA_PATTERN.test(content)) {
    return <>{content}</>;
  }

  // Reset regex state
  MEDIA_PATTERN.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MEDIA_PATTERN.exec(content)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) parts.push(<span key={`t-${lastIndex}`}>{textBefore}</span>);
    }
    // Media card
    parts.push(<MediaCard key={`m-${match.index}`} type={match[1]} fileName={match[2]} />);
    lastIndex = match.index + match[0].length;
  }

  // Text after last match
  const textAfter = content.slice(lastIndex).trim();
  if (textAfter) parts.push(<span key={`t-${lastIndex}`}>{textAfter}</span>);

  return <>{parts}</>;
}

// ─── Types ──────────────────────────────────────────────

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
  toolCalls?: DryRunToolCall[];
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
  /** Playground tool state — converted to OpenRouter tools for dry-run */
  playgroundTools?: Record<string, PlaygroundToolState>;
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
  playgroundTools,
}: LivePreviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevConfigVersionRef = useRef(configVersion);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const canTest = systemPrompt.trim().length >= 30;

  // KB do agente — alimenta a tool send_document do preview. Sem ela o Simular
  // NÃO consegue enviar mídia: o modelo no máximo diz que mandou, e a regra
  // "anunciou, enviou" fica impossível de verificar na tela.
  const { data: agentDocuments } = useAgentDocuments(agentId);

  // Build OpenRouter tool defs from playground tool state + KB real
  const openRouterTools = useMemo(
    () => [
      ...(playgroundTools ? buildPreviewTools(playgroundTools) : []),
      ...buildSendDocumentTool(agentDocuments),
    ],
    [playgroundTools, agentDocuments],
  );

  // Scroll to bottom — só da lista. `scrollIntoView` rolava também a página:
  // no celular, ao montar, levava a tela até o fim do chat e cortava o topo.
  useEffect(() => {
    const list = messagesListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
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

  interface EdgeFunctionResult {
    parts: string[];
    toolCalls?: DryRunToolCall[];
  }

  const callEdgeFunction = useCallback(
    async (
      currentMessages: ChatMessage[],
      userMsg: string,
      generateFirst: boolean,
      attachment?: ChatAttachment,
    ): Promise<EdgeFunctionResult> => {
      // Send the user's session JWT (not the anon key) so the edge fn can authenticate the
      // caller and authorize the requested agentId against their org (audit 2026-07-14 #6).
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? anonKey;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/test-copilot-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: anonKey,
          },
          body: JSON.stringify({
            systemPrompt,
            messages: currentMessages.slice(-20).map(({ role, content }) => ({ role, content })),
            userMessage: userMsg,
            generateFirstMessage: generateFirst,
            ...(generateFirst && firstMessageTemplate ? { firstMessageTemplate } : {}),
            ...(agentId ? { agentId } : {}),
            ...(attachment ? { attachment: { base64: attachment.base64, mimeType: attachment.mimeType, fileName: attachment.fileName } } : {}),
            ...(openRouterTools.length > 0 && !generateFirst ? { tools: openRouterTools } : {}),
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
      if (result?.error) throw new Error(result.error as string);

      const parts = (result?.messages as string[] | undefined) || [result?.message as string];
      if (!parts[0]) throw new Error("Resposta vazia do agente");

      const toolCalls = result?.toolCalls as DryRunToolCall[] | undefined;
      return { parts, toolCalls: toolCalls?.length ? toolCalls : undefined };
    },
    [systemPrompt, firstMessageTemplate, supabaseUrl, anonKey, agentId, openRouterTools]
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
      const { parts, toolCalls } = await callEdgeFunction(messages, userMessage || "[Arquivo enviado]", false, currentAttachment);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) await new Promise<void>((r) => setTimeout(r, 700));
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: parts[i],
            // Attach toolCalls to the first message part only
            ...(i === 0 && toolCalls ? { toolCalls } : {}),
          },
        ]);
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
        const { parts: firstParts } = await callEdgeFunction([], "", true);
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

        const { parts: agentParts, toolCalls } = await callEdgeFunction(currentMessages, leadMsg, false);
        for (let j = 0; j < agentParts.length; j++) {
          currentMessages.push({
            role: "assistant",
            content: agentParts[j],
            ...(j === 0 && toolCalls ? { toolCalls } : {}),
          });
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
    <div className="flex h-full flex-col overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
      {/* Header — faixa de tinta: é a "tela do lead", não parte do formulário */}
      <div className="flex items-center justify-between bg-tinta px-4 py-3 text-tinta-foreground">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{agentName || "Agente"}</p>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="border-white/15 bg-white/[.06] px-1.5 py-0 text-[10px] text-tinta-muted">
                Live Preview
              </Badge>
              {agentId && (
                <Badge variant="outline" className="border-success/30 bg-success/15 px-1.5 py-0 text-[10px] text-success">
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
            className="h-8 gap-1 px-2.5 text-xs text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
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
              className="h-8 w-8 rounded-[10px] p-0 text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
              aria-label="Reiniciar conversa"
              onClick={handleReset}
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesListRef} className="flex-1 overflow-y-auto scroll-smooth p-4 space-y-3 min-h-0">
        {messages.length === 0 && !isSimulating ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-foreground/50">
              <MessageSquare className="w-5 h-5" />
            </span>
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
              </>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div key={idx} className="space-y-1.5">
                {/* Dry-run tool call cards — rendered ABOVE the message */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="flex gap-2 justify-start">
                    <div className="w-6 flex-shrink-0" />
                    <div className="max-w-[85%] space-y-1">
                      {msg.toolCalls.map((tc, tcIdx) => (
                        <div
                          key={`tc-${idx}-${tcIdx}`}
                          className="flex items-center gap-2 rounded-xl border border-dashed border-warning/40 bg-warning/[.08] px-2.5 py-1.5"
                        >
                          <Wrench className="w-3.5 h-3.5 shrink-0 text-warning-strong" />
                          <span className="text-xs text-foreground/90">
                            <span className="font-semibold text-warning-strong">{tc.name}</span>
                            {" "}
                            <span className="text-muted-foreground">
                              {describeToolCall(tc, agentDocuments)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "rounded-br-md bg-tinta text-tinta-foreground"
                        : "rounded-bl-md border border-border/60 bg-sunken"
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
                      <div className="flex items-center gap-1.5 mb-1 px-2 py-1 rounded bg-foreground/10 text-xs">
                        <FileText className="w-3.5 h-3.5" />
                        {msg.attachment.fileName}
                      </div>
                    )}
                    <MessageContent content={msg.content} isUser={msg.role === "user"} />
                  </div>
                  {msg.role === "user" && (
                    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Tool call indicator */}
            {messages.some((m) => m.toolCall) &&
              messages
                .filter((m) => m.toolCall)
                .map((m, idx) => (
                  <div key={`tool-${idx}`} className="flex justify-center">
                    <Badge variant="soft" className="gap-1 text-[10px]">
                      {m.toolCall}
                    </Badge>
                  </div>
                ))}
          </>
        )}

        {/* Typing indicator */}
        {(isSending || isSimulating) && (
          <div className="flex gap-2 justify-start">
            <div className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="rounded-2xl rounded-bl-md border border-border/60 bg-sunken px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Config changed notice */}
      {prevConfigVersionRef.current !== configVersion && messages.length > 0 && (
        <div className="border-t border-warning/25 bg-warning/10 px-4 py-1.5">
          <p className="text-center text-[11px] font-medium text-warning-strong">
            Configuração alterada — conversa será reiniciada
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
              className="h-12 w-12 rounded-lg border object-cover"
            />
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border bg-sunken px-2 py-1.5 text-xs">
              <FileText className="w-3.5 h-3.5" />
              {pendingAttachment.fileName}
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-[9px]"
            aria-label="Remover anexo"
            onClick={() => {
              if (pendingAttachment.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
              setPendingAttachment(null);
            }}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Sugestões — sempre à mão, não só na conversa vazia */}
      {canTest && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-border/60 px-3 pt-2.5 scrollbar-hide">
          {PREVIEW_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold shadow-relevo transition-colors hover:border-foreground/20 disabled:opacity-50"
              onClick={() => setInputValue(s)}
              disabled={isSending || isSimulating}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={`flex gap-2 p-3 ${canTest ? "" : "border-t border-border/60"}`}>
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
          aria-label="Anexar arquivo"
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
          className="h-9 flex-1 rounded-full text-sm"
        />
        <Button
          type="button"
          size="icon"
          className="h-9 w-9 rounded-full"
          aria-label="Enviar"
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
      <p className="border-t border-border/60 px-4 py-2 text-[11px] leading-snug text-muted-foreground">
        Simulação: usa o prompt e as ferramentas desta tela, mesmo antes de salvar. Nada é enviado ao lead.
      </p>
    </div>
  );
}
