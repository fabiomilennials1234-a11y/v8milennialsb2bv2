# Agendamento de Mensagens WhatsApp — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que vendedores agendem mensagens WhatsApp (texto + mídia) para envio automático em data/hora específica, com gestão inline no chat e visibilidade nos pipes.

**Architecture:** Nova tabela `scheduled_user_messages` + Edge Function worker rodando via pg_cron a cada 1 min. UI integrada via modal reutilizável (`ScheduleMessageModal`) nos 3 pontos de entrada (chat, drawer, kanban). Reutiliza `outbound-sender.ts` para envio real via Evolution API / SZ.chat.

**Tech Stack:** Supabase (Postgres + Edge Functions + pg_cron + Storage), React, TanStack Query, shadcn/ui, Framer Motion, date-fns.

**Spec:** `docs/superpowers/specs/2026-03-29-scheduled-messages-design.md`

---

## File Map

### Criar:
| Arquivo | Responsabilidade |
|---------|-----------------|
| `supabase/migrations/20260329000000_scheduled_user_messages.sql` | Tabela, indexes, RLS, cron job |
| `supabase/functions/process-scheduled-user-messages/index.ts` | Worker que processa fila a cada 1 min |
| `src/hooks/useScheduledMessages.ts` | Hooks de query + mutations (CRUD) |
| `src/components/chat/ScheduleMessageModal.tsx` | Modal de agendamento reutilizável |
| `src/components/chat/ScheduledMessagesBanner.tsx` | Banner inline no chat com lista expansível |

### Modificar:
| Arquivo | Mudança |
|---------|---------|
| `src/components/chat/WhatsAppChat.tsx` | Botão Clock no input + montar banner |
| `src/components/leads/LeadDetailDrawer.tsx` | Botão "Agendar mensagem" na aba Contexto |
| `src/components/leads/LeadCard.tsx` | Badge Clock + item no DropdownMenu |
| `src/components/kanban/KanbanCard.tsx` | Badge Clock + item no DropdownMenu |
| `src/pages/PipeWhatsapp.tsx` | Filtro "Com agendamento" |
| `src/pages/PipeConfirmacao.tsx` | Filtro "Com agendamento" |
| `src/pages/PipePropostas.tsx` | Filtro "Com agendamento" |

---

## Task 1: Migration — Tabela + Indexes + RLS + Cron

**Files:**
- Create: `supabase/migrations/20260329000000_scheduled_user_messages.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- Agendamento de mensagens WhatsApp pelo usuário
-- Tabela para mensagens agendadas manualmente (não automação de pipe/campanha)

CREATE TABLE public.scheduled_user_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES team_members(id),
  whatsapp_instance_id UUID REFERENCES whatsapp_instances(id),
  message_content TEXT,
  media_url TEXT,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio', 'document')),
  media_filename TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_or_media CHECK (message_content IS NOT NULL OR media_url IS NOT NULL)
);

-- Worker: pegar pendentes eficientemente
CREATE INDEX idx_scheduled_user_messages_worker
  ON scheduled_user_messages (scheduled_at)
  WHERE status = 'scheduled';

-- Listar por lead (banner inline no chat)
CREATE INDEX idx_scheduled_user_messages_lead
  ON scheduled_user_messages (lead_id, status);

-- Listar por membro
CREATE INDEX idx_scheduled_user_messages_member
  ON scheduled_user_messages (created_by, status);

-- RLS
ALTER TABLE scheduled_user_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own org scheduled messages"
  ON scheduled_user_messages FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can insert own org scheduled messages"
  ON scheduled_user_messages FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can update own scheduled messages"
  ON scheduled_user_messages FOR UPDATE
  USING (created_by IN (
    SELECT id FROM team_members WHERE user_id = auth.uid()
  ));

-- pg_cron: invocar Edge Function a cada 1 minuto
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_user_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_scheduled_user_messages_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-scheduled-user-messages',
      '* * * * *',
      'SELECT public.invoke_process_scheduled_user_messages()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END
$outer$;
```

- [ ] **Step 2: Aplicar migration localmente**

Run: `npx supabase db push` ou `npx supabase migration up`
Expected: Migration aplicada sem erros.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260329000000_scheduled_user_messages.sql
git commit -m "feat(db): add scheduled_user_messages table with RLS and cron"
```

---

## Task 2: Edge Function — Worker de processamento

**Files:**
- Create: `supabase/functions/process-scheduled-user-messages/index.ts`

- [ ] **Step 1: Criar Edge Function**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 20;

Deno.serve(async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date().toISOString();

    // 1. Buscar mensagens pendentes
    const { data: messages, error: fetchError } = await supabase
      .from("scheduled_user_messages")
      .select("*, lead:leads(name)")
      .eq("status", "scheduled")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[scheduled-user-messages] Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!messages?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const msg of messages) {
      // 2. Lock otimista
      const { error: lockErr } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "sending" })
        .eq("id", msg.id)
        .eq("status", "scheduled");

      if (lockErr) { failed++; continue; }

      try {
        // 3. Resolver instância WhatsApp
        let instanceName: string | null = null;
        let isSzChat = false;

        if (msg.whatsapp_instance_id) {
          const { data: inst } = await supabase
            .from("whatsapp_instances")
            .select("instance_name, metadata")
            .eq("id", msg.whatsapp_instance_id)
            .single();
          instanceName = inst?.instance_name ?? null;
          isSzChat = inst?.metadata?.provider === "szchat";
        }

        if (!instanceName) {
          // Fallback: instância default da org
          const { data: defaultInst } = await supabase
            .from("whatsapp_instances")
            .select("instance_name, metadata")
            .eq("organization_id", msg.organization_id)
            .eq("status", "connected")
            .limit(1)
            .single();
          instanceName = defaultInst?.instance_name ?? null;
          isSzChat = defaultInst?.metadata?.provider === "szchat";
        }

        if (!instanceName) {
          throw new Error("Nenhuma instância WhatsApp disponível");
        }

        // 4. Enviar mensagem
        const formattedNumber = msg.phone_number.replace(/\D/g, "");

        if (msg.message_content) {
          if (isSzChat) {
            await supabase.functions.invoke("sz-chat-send", {
              body: {
                action: "send_message",
                organization_id: msg.organization_id,
                phone_number: formattedNumber,
                message: msg.message_content,
              },
            });
          } else {
            await supabase.functions.invoke("evolution-api-proxy", {
              body: {
                endpoint: `/message/sendText/${instanceName}`,
                method: "POST",
                body: { number: formattedNumber, text: msg.message_content },
              },
            });
          }
        }

        if (msg.media_url && msg.media_type) {
          const mediaEndpoint = msg.media_type === "audio"
            ? `/message/sendWhatsAppAudio/${instanceName}`
            : `/message/sendMedia/${instanceName}`;

          await supabase.functions.invoke("evolution-api-proxy", {
            body: {
              endpoint: mediaEndpoint,
              method: "POST",
              body: {
                number: formattedNumber,
                media: msg.media_url,
                mediatype: msg.media_type,
                fileName: msg.media_filename || undefined,
                caption: msg.media_type !== "audio" ? msg.message_content : undefined,
              },
            },
          });
        }

        // 5. Sucesso — atualizar status
        await supabase
          .from("scheduled_user_messages")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", msg.id);

        // 6. Salvar no histórico do chat
        const messageId = `sched_${msg.id}_${Date.now()}`;
        await supabase.from("whatsapp_messages").insert({
          organization_id: msg.organization_id,
          instance_id: msg.whatsapp_instance_id,
          message_id: messageId,
          remote_jid: `${formattedNumber}@s.whatsapp.net`,
          phone_number: msg.phone_number,
          direction: "outgoing",
          message_type: msg.media_type || "text",
          content: msg.message_content,
          media_url: msg.media_url,
          status: "sent",
          lead_id: msg.lead_id,
          timestamp: new Date().toISOString(),
        });

        // 7. Notificar vendedor (sucesso)
        const { data: member } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("id", msg.created_by)
          .single();

        if (member?.user_id) {
          await supabase.from("notifications").insert({
            organization_id: msg.organization_id,
            user_id: member.user_id,
            type: "scheduled_message_sent",
            title: "Mensagem agendada enviada",
            description: `Mensagem para ${msg.lead?.name || "lead"} enviada com sucesso`,
            lead_id: msg.lead_id,
          });
        }

        sent++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const newRetry = (msg.retry_count || 0) + 1;

        if (newRetry < 3) {
          // Retry com backoff de 2 min
          const retryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "scheduled", retry_count: newRetry, scheduled_at: retryAt })
            .eq("id", msg.id);
        } else {
          // Falha definitiva
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "failed", error_message: errorMessage, retry_count: newRetry })
            .eq("id", msg.id);

          // Notificar vendedor (falha)
          const { data: member } = await supabase
            .from("team_members")
            .select("user_id")
            .eq("id", msg.created_by)
            .single();

          if (member?.user_id) {
            await supabase.from("notifications").insert({
              organization_id: msg.organization_id,
              user_id: member.user_id,
              type: "scheduled_message_failed",
              title: "Falha no envio agendado",
              description: `Não foi possível enviar para ${msg.lead?.name || "lead"}: ${errorMessage}`,
              lead_id: msg.lead_id,
            });
          }
        }

        failed++;
      }
    }

    await logRuntime({
      module: "scheduled_user_messages",
      action: "process_batch",
      status: "success",
      payloadSnapshot: { processed: messages.length, sent, failed },
    });

    return new Response(
      JSON.stringify({ processed: messages.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[scheduled-user-messages] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/process-scheduled-user-messages/index.ts
git commit -m "feat(edge): add process-scheduled-user-messages worker"
```

---

## Task 3: Hooks — useScheduledMessages

**Files:**
- Create: `src/hooks/useScheduledMessages.ts`

- [ ] **Step 1: Criar hooks**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { toast } from "sonner";

export interface ScheduledMessage {
  id: string;
  organization_id: string;
  lead_id: string;
  phone_number: string;
  created_by: string;
  whatsapp_instance_id: string | null;
  message_content: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  sent_at: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}

/** Mensagens agendadas pendentes de um lead específico */
export function useScheduledMessagesForLead(leadId: string | null) {
  return useQuery({
    queryKey: ["scheduled-messages", "lead", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .select("*")
        .eq("lead_id", leadId)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data as ScheduledMessage[];
    },
    enabled: !!leadId,
  });
}

/** Set de lead_ids com agendamentos pendentes (para filtro nos pipes) */
export function useLeadsWithScheduledMessages() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["scheduled-messages", "lead-ids", organizationId],
    queryFn: async () => {
      if (!organizationId) return new Set<string>();
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .eq("status", "scheduled");
      if (error) throw error;
      return new Set(data.map((r) => r.lead_id));
    },
    enabled: !!organizationId,
    refetchInterval: 60_000,
  });
}

/** Criar mensagem agendada */
export function useCreateScheduledMessage() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: member } = useCurrentTeamMember();
  const logAction = useLogLeadAction();

  return useMutation({
    mutationFn: async (input: {
      leadId: string;
      phoneNumber: string;
      messageContent?: string;
      mediaFile?: File;
      scheduledAt: Date;
      instanceId?: string;
    }) => {
      if (!organizationId || !member) throw new Error("Contexto não disponível");

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mediaFilename: string | null = null;

      // Upload mídia se houver
      if (input.mediaFile) {
        const ext = input.mediaFile.name.split(".").pop() || "bin";
        const path = `scheduled-messages/${organizationId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("media")
          .upload(path, input.mediaFile);
        if (uploadErr) throw new Error("Erro no upload: " + uploadErr.message);

        const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
        mediaUrl = urlData.publicUrl;
        mediaFilename = input.mediaFile.name;

        const mime = input.mediaFile.type;
        if (mime.startsWith("image/")) mediaType = "image";
        else if (mime.startsWith("video/")) mediaType = "video";
        else if (mime.startsWith("audio/")) mediaType = "audio";
        else mediaType = "document";
      }

      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .insert({
          organization_id: organizationId,
          lead_id: input.leadId,
          phone_number: input.phoneNumber,
          created_by: member.id,
          whatsapp_instance_id: input.instanceId || null,
          message_content: input.messageContent || null,
          media_url: mediaUrl,
          media_type: mediaType,
          media_filename: mediaFilename,
          scheduled_at: input.scheduledAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logAction({
        leadId: input.leadId,
        action: "scheduled_message_created",
        description: `Mensagem agendada para ${input.scheduledAt.toLocaleString("pt-BR")}`,
      });

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success(
        `Mensagem agendada para ${variables.scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao agendar mensagem");
    },
  });
}

/** Cancelar mensagem agendada */
export function useCancelScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "scheduled");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success("Agendamento cancelado");
    },
  });
}

/** Editar mensagem agendada (conteúdo e/ou horário) */
export function useUpdateScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      messageContent?: string;
      scheduledAt?: Date;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.messageContent !== undefined) updates.message_content = input.messageContent;
      if (input.scheduledAt) updates.scheduled_at = input.scheduledAt.toISOString();

      const { error } = await supabase
        .from("scheduled_user_messages")
        .update(updates)
        .eq("id", input.id)
        .eq("status", "scheduled");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success("Agendamento atualizado");
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useScheduledMessages.ts
git commit -m "feat(hooks): add useScheduledMessages CRUD hooks"
```

---

## Task 4: ScheduleMessageModal

**Files:**
- Create: `src/components/chat/ScheduleMessageModal.tsx`

- [ ] **Step 1: Criar componente**

```typescript
import { useState, useRef } from "react";
import { format, addDays, nextMonday, isBefore, addMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, Paperclip, X, Image as ImageIcon, FileText, Music } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateScheduledMessage, useUpdateScheduledMessage } from "@/hooks/useScheduledMessages";
import { cn } from "@/lib/utils";

interface ScheduleMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
  instanceName?: string;
  initialMessage?: string;
  initialMediaFile?: File;
  editingId?: string;
  editingContent?: string;
  editingScheduledAt?: Date;
}

const MEDIA_ICON_MAP: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: ImageIcon,
  audio: Music,
  document: FileText,
};

function getMediaType(file: File): string {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export function ScheduleMessageModal({
  open,
  onOpenChange,
  leadId,
  leadName,
  phoneNumber,
  instanceId,
  initialMessage = "",
  initialMediaFile,
  editingId,
  editingContent,
  editingScheduledAt,
}: ScheduleMessageModalProps) {
  const [message, setMessage] = useState(editingContent ?? initialMessage);
  const [mediaFile, setMediaFile] = useState<File | null>(initialMediaFile ?? null);
  const [date, setDate] = useState<Date | undefined>(editingScheduledAt);
  const [time, setTime] = useState(editingScheduledAt ? format(editingScheduledAt, "HH:mm") : "09:00");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createMutation = useCreateScheduledMessage();
  const updateMutation = useUpdateScheduledMessage();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const scheduledDateTime = date
    ? (() => {
        const [h, m] = time.split(":").map(Number);
        const dt = new Date(date);
        dt.setHours(h, m, 0, 0);
        return dt;
      })()
    : null;

  const isValid =
    (message.trim() || mediaFile) &&
    scheduledDateTime &&
    isBefore(addMinutes(new Date(), 1), scheduledDateTime);

  const handleSubmit = async () => {
    if (!scheduledDateTime || !isValid) return;

    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        messageContent: message.trim() || undefined,
        scheduledAt: scheduledDateTime,
      });
    } else {
      await createMutation.mutateAsync({
        leadId,
        phoneNumber,
        messageContent: message.trim() || undefined,
        mediaFile: mediaFile || undefined,
        scheduledAt: scheduledDateTime,
        instanceId,
      });
    }

    setMessage("");
    setMediaFile(null);
    setDate(undefined);
    setTime("09:00");
    onOpenChange(false);
  };

  const quickDates = [
    { label: "Amanhã 9h", getDate: () => { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Em 2 dias", getDate: () => { const d = addDays(new Date(), 2); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Seg 9h", getDate: () => { const d = nextMonday(new Date()); d.setHours(9, 0, 0, 0); return d; } },
    { label: "1 semana", getDate: () => { const d = addDays(new Date(), 7); d.setHours(9, 0, 0, 0); return d; } },
  ];

  const handleQuickDate = (getDate: () => Date) => {
    const d = getDate();
    setDate(d);
    setTime(format(d, "HH:mm"));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setMediaFile(file);
    e.target.value = "";
  };

  const MediaIcon = mediaFile ? MEDIA_ICON_MAP[getMediaType(mediaFile)] || FileText : FileText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Agendar mensagem
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Para {leadName}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mensagem + mídia */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escreva a mensagem..."
                rows={3}
                className="flex-1 bg-muted rounded-lg resize-none"
              />
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!!editingId}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Preview de mídia */}
            {mediaFile && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted border border-border">
                <MediaIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {mediaFile.name}
                </span>
                <button
                  onClick={() => setMediaFile(null)}
                  className="p-0.5 rounded hover:bg-background"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            )}
          </div>

          {/* Quick dates */}
          <div className="space-y-2">
            <p className="stat-card-label">Quando enviar</p>
            <div className="flex flex-wrap gap-2">
              {quickDates.map((qd) => {
                const targetDate = qd.getDate();
                const isSelected = date && scheduledDateTime &&
                  scheduledDateTime.getTime() === targetDate.getTime();

                return (
                  <Button
                    key={qd.label}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className="text-xs"
                    onClick={() => handleQuickDate(qd.getDate)}
                  >
                    {qd.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Calendar + Time */}
          <div className="flex gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start gap-2 text-sm">
                  <Clock className="w-4 h-4" />
                  {date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "Escolher data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  locale={ptBR}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-28"
            />
          </div>

          {/* Indicador */}
          {scheduledDateTime && isValid && (
            <p className="text-xs text-muted-foreground">
              Será enviada em{" "}
              <span className="font-medium text-foreground">
                {format(scheduledDateTime, "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
              </span>
            </p>
          )}

          {scheduledDateTime && !isValid && date && (
            <p className="text-xs text-destructive">
              A data precisa ser no futuro (mínimo 1 minuto a partir de agora)
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isPending}
            className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
          >
            {isPending ? "Agendando..." : editingId ? "Salvar" : "Agendar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/ScheduleMessageModal.tsx
git commit -m "feat(ui): add ScheduleMessageModal component"
```

---

## Task 5: ScheduledMessagesBanner (inline no chat)

**Files:**
- Create: `src/components/chat/ScheduledMessagesBanner.tsx`

- [ ] **Step 1: Criar componente**

```typescript
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Clock, ChevronDown, ChevronUp, X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useScheduledMessagesForLead,
  useCancelScheduledMessage,
  type ScheduledMessage,
} from "@/hooks/useScheduledMessages";
import { ScheduleMessageModal } from "./ScheduleMessageModal";
import { cn } from "@/lib/utils";

interface ScheduledMessagesBannerProps {
  leadId: string;
  leadName: string;
  phoneNumber: string;
  instanceId?: string;
}

export function ScheduledMessagesBanner({
  leadId,
  leadName,
  phoneNumber,
  instanceId,
}: ScheduledMessagesBannerProps) {
  const { data: scheduled = [] } = useScheduledMessagesForLead(leadId);
  const cancelMutation = useCancelScheduledMessage();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);

  if (scheduled.length === 0) return null;

  return (
    <>
      <div className="mx-4 mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm transition-colors hover:bg-primary/10"
        >
          <span className="flex items-center gap-2 text-foreground/80">
            <Clock className="w-3.5 h-3.5 text-primary" />
            {scheduled.length} mensagem{scheduled.length > 1 ? "ns" : ""} agendada{scheduled.length > 1 ? "s" : ""}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="mt-1 space-y-1">
            {scheduled.map((msg) => (
              <div
                key={msg.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border text-xs"
              >
                <span className="flex-1 truncate text-muted-foreground">
                  {msg.message_content
                    ? msg.message_content.slice(0, 50) + (msg.message_content.length > 50 ? "..." : "")
                    : `[${msg.media_type || "mídia"}]`}
                </span>
                <span className="text-muted-foreground/70 whitespace-nowrap">
                  {format(new Date(msg.scheduled_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(msg);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                  title="Editar"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelMutation.mutate(msg.id);
                  }}
                  className="p-0.5 rounded hover:bg-muted"
                  title="Cancelar"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ScheduleMessageModal
          open={!!editing}
          onOpenChange={(v) => { if (!v) setEditing(null); }}
          leadId={leadId}
          leadName={leadName}
          phoneNumber={phoneNumber}
          instanceId={instanceId}
          editingId={editing.id}
          editingContent={editing.message_content || ""}
          editingScheduledAt={new Date(editing.scheduled_at)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/ScheduledMessagesBanner.tsx
git commit -m "feat(ui): add ScheduledMessagesBanner for inline chat display"
```

---

## Task 6: Integrar no Chat WhatsApp

**Files:**
- Modify: `src/components/chat/WhatsAppChat.tsx`

- [ ] **Step 1: Adicionar imports e state**

No topo do arquivo, adicionar:
```typescript
import { ScheduleMessageModal } from "./ScheduleMessageModal";
import { ScheduledMessagesBanner } from "./ScheduledMessagesBanner";
```

Dentro do componente `WhatsAppChat`, junto aos outros `useState`:
```typescript
const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
```

- [ ] **Step 2: Adicionar banner no chat**

Antes da área de mensagens (acima do `<div ref={scrollRef}>` das mensagens), inserir:
```typescript
{selectedContact && selectedContact.leadId && (
  <ScheduledMessagesBanner
    leadId={selectedContact.leadId}
    leadName={selectedContact.name || selectedContact.phone}
    phoneNumber={selectedContact.phone}
    instanceId={instanceId}
  />
)}
```

- [ ] **Step 3: Adicionar botão Clock na barra de input**

Na barra de input, entre o textarea e o botão Send, adicionar o botão Clock:
```typescript
{newMessage.trim() && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => setScheduleModalOpen(true)}
    title="Agendar mensagem"
    className="text-muted-foreground hover:text-primary"
  >
    <Clock className="w-4 h-4" />
  </Button>
)}
```

Importar `Clock` de lucide-react (provavelmente já existe no arquivo).

- [ ] **Step 4: Adicionar modal no final do componente**

Antes do `</div>` de fechamento do componente, adicionar:
```typescript
{selectedContact && (
  <ScheduleMessageModal
    open={scheduleModalOpen}
    onOpenChange={setScheduleModalOpen}
    leadId={selectedContact.leadId || ""}
    leadName={selectedContact.name || selectedContact.phone}
    phoneNumber={selectedContact.phone}
    instanceId={instanceId}
    instanceName={instanceName}
    initialMessage={newMessage}
  />
)}
```

- [ ] **Step 5: Limpar input após agendar**

No `onOpenChange` do modal, adicionar lógica para limpar o input quando fecha após sucesso:
```typescript
onOpenChange={(v) => {
  setScheduleModalOpen(v);
  if (!v && !newMessage.trim()) {
    // Input já limpo pelo modal — nada a fazer
  }
}}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/WhatsAppChat.tsx
git commit -m "feat(chat): integrate schedule button and banner in WhatsApp chat"
```

---

## Task 7: Integrar no LeadDetailDrawer

**Files:**
- Modify: `src/components/leads/LeadDetailDrawer.tsx`

- [ ] **Step 1: Adicionar import e state**

```typescript
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
```

Junto aos outros `useState`:
```typescript
const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
```

- [ ] **Step 2: Adicionar botão na aba Contexto**

Junto ao `ScheduleFollowUpButton` existente, adicionar:
```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => setScheduleModalOpen(true)}
  className="gap-1.5"
>
  <Clock className="w-4 h-4" />
  Agendar mensagem
</Button>
```

Importar `Clock` de lucide-react.

- [ ] **Step 3: Adicionar modal no final**

```typescript
<ScheduleMessageModal
  open={scheduleModalOpen}
  onOpenChange={setScheduleModalOpen}
  leadId={leadId}
  leadName={leadName}
  phoneNumber={leadPhone || ""}
/>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadDetailDrawer.tsx
git commit -m "feat(leads): add schedule message button to LeadDetailDrawer"
```

---

## Task 8: Integrar nos Kanban Cards (LeadCard + KanbanCard)

**Files:**
- Modify: `src/components/leads/LeadCard.tsx`
- Modify: `src/components/kanban/KanbanCard.tsx`

- [ ] **Step 1: LeadCard — adicionar badge e dropdown item**

No `LeadCard.tsx`, importar:
```typescript
import { Clock } from "lucide-react";
import { useScheduledMessagesForLead } from "@/hooks/useScheduledMessages";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
```

Dentro do componente, adicionar state e query:
```typescript
const [scheduleOpen, setScheduleOpen] = useState(false);
const { data: scheduledMsgs = [] } = useScheduledMessagesForLead(lead.leadId || null);
const hasScheduled = scheduledMsgs.length > 0;
```

No `DropdownMenuContent`, antes do item "Remover do funil", adicionar:
```typescript
<DropdownMenuItem onClick={(e) => { e.stopPropagation(); setScheduleOpen(true); }}>
  <Clock className="w-4 h-4 mr-2" />
  Agendar mensagem
</DropdownMenuItem>
```

Na área de badges (junto ao calor, tags, etc.), adicionar:
```typescript
{hasScheduled && (
  <span className="flex items-center gap-0.5 text-primary/70" title={`${scheduledMsgs.length} agendada(s)`}>
    <Clock className="w-3 h-3" />
  </span>
)}
```

No final do componente, antes do `</motion.div>` de fechamento:
```typescript
{scheduleOpen && (
  <ScheduleMessageModal
    open={scheduleOpen}
    onOpenChange={setScheduleOpen}
    leadId={lead.leadId || ""}
    leadName={lead.name}
    phoneNumber={lead.phone || ""}
  />
)}
```

- [ ] **Step 2: KanbanCard — adicionar badge e dropdown item**

Mesmo pattern do LeadCard. No `KanbanCard.tsx`:
- Importar `Clock`, `useScheduledMessagesForLead`, `ScheduleMessageModal`
- Adicionar state `scheduleOpen` e query `scheduledMsgs`
- Adicionar `DropdownMenuItem` e badge Clock
- Adicionar modal no final

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/LeadCard.tsx src/components/kanban/KanbanCard.tsx
git commit -m "feat(kanban): add schedule message badge and action to cards"
```

---

## Task 9: Filtro "Com agendamento" nos Pipes

**Files:**
- Modify: `src/pages/PipeWhatsapp.tsx`
- Modify: `src/pages/PipeConfirmacao.tsx`
- Modify: `src/pages/PipePropostas.tsx`

- [ ] **Step 1: PipeWhatsapp — adicionar filtro**

Importar:
```typescript
import { useLeadsWithScheduledMessages } from "@/hooks/useScheduledMessages";
```

Dentro do componente:
```typescript
const { data: leadsWithSchedule } = useLeadsWithScheduledMessages();
const [filterScheduled, setFilterScheduled] = useState(false);
```

Na função `filterItems`, adicionar:
```typescript
// Filtro de agendamento
const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);

return matchesSearch && matchesResponsible && matchesOrigin && matchesScheduled;
```

Na UI de filtros, junto aos outros dropdowns, adicionar toggle:
```typescript
<Button
  variant={filterScheduled ? "default" : "outline"}
  size="sm"
  onClick={() => setFilterScheduled(!filterScheduled)}
  className="gap-1.5"
>
  <Clock className="w-4 h-4" />
  Agendados
</Button>
```

Adicionar `filterScheduled` e `leadsWithSchedule` às dependências do `useMemo` do columns.

- [ ] **Step 2: PipeConfirmacao — mesmo pattern**

Replicar exatamente o mesmo pattern do Step 1 em `PipeConfirmacao.tsx`.

- [ ] **Step 3: PipePropostas — mesmo pattern**

Replicar exatamente o mesmo pattern do Step 1 em `PipePropostas.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/PipeWhatsapp.tsx src/pages/PipeConfirmacao.tsx src/pages/PipePropostas.tsx
git commit -m "feat(pipes): add 'with scheduled messages' filter to all pipes"
```

---

## Task 10: Verificação final

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: Zero erros.

- [ ] **Step 2: Build**

Run: `npx vite build`
Expected: Build completo sem erros.

- [ ] **Step 3: Commit final (se houver fixes)**

```bash
git add -A
git commit -m "fix: resolve build issues from scheduled messages feature"
```

- [ ] **Step 4: Push**

```bash
git push origin develop
```
