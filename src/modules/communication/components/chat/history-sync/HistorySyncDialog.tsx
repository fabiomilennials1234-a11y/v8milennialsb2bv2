/**
 * HistorySyncDialog — cria history_sync_jobs com 3 scopes:
 *  - default: 30d / 500 msg/chat / 100 chats (limites seguros, 90% casos)
 *  - full: sem cutoff de dias, toggle obrigatório com warning
 *  - chat: sync de 1 chat específico (chat_jid)
 *
 * Consumido no WhatsAppSettings via botão "Importar histórico".
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateHistorySyncJob,
  type SyncScope,
} from "@/modules/communication/hooks/useHistorySyncJobs";

interface Props {
  instanceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HistorySyncDialog({ instanceId, open, onOpenChange }: Props) {
  const [scope, setScope] = useState<SyncScope>("default");
  const [maxDays, setMaxDays] = useState<number>(30);
  const [maxMsgs, setMaxMsgs] = useState<number>(500);
  const [maxChats, setMaxChats] = useState<number>(100);
  const [chatJid, setChatJid] = useState("");
  const [confirmFull, setConfirmFull] = useState(false);

  const createJob = useCreateHistorySyncJob();

  const handleSubmit = async () => {
    if (!instanceId) return;
    try {
      await createJob.mutateAsync({
        instance_id: instanceId,
        scope,
        chat_jid: scope === "chat" ? chatJid.trim() || null : null,
        max_days: scope === "full" ? 0 : maxDays,
        max_messages_per_chat: maxMsgs,
        max_chats: maxChats,
      });
      toast.success("Import agendado. Acompanhe na lista de jobs.");
      onOpenChange(false);
    } catch (e) {
      toast.error(`Erro ao criar job: ${(e as Error).message}`);
    }
  };

  const canSubmit =
    !!instanceId &&
    (scope !== "full" || confirmFull) &&
    (scope !== "chat" || chatJid.trim().length > 0) &&
    !createJob.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar histórico WhatsApp</DialogTitle>
          <DialogDescription>
            Uma task assíncrona busca mensagens antigas no Uazapi em chunks de 100/minuto.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={scope} onValueChange={(v) => setScope(v as SyncScope)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="default">Padrão</TabsTrigger>
            <TabsTrigger value="full">Completo</TabsTrigger>
            <TabsTrigger value="chat">Por chat</TabsTrigger>
          </TabsList>

          <TabsContent value="default" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Importa até <strong>{maxDays} dias</strong> recentes, <strong>{maxMsgs}</strong> mensagens por chat, até <strong>{maxChats}</strong> chats. Cobre 90% dos casos de onboarding.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="max_days">Dias</Label>
                <Input
                  id="max_days"
                  type="number"
                  value={maxDays}
                  onChange={(e) => setMaxDays(Number(e.target.value))}
                  min={1}
                  max={365}
                />
              </div>
              <div>
                <Label htmlFor="max_msgs">Msgs/chat</Label>
                <Input
                  id="max_msgs"
                  type="number"
                  value={maxMsgs}
                  onChange={(e) => setMaxMsgs(Number(e.target.value))}
                  min={1}
                  max={5000}
                />
              </div>
              <div>
                <Label htmlFor="max_chats">Chats</Label>
                <Input
                  id="max_chats"
                  type="number"
                  value={maxChats}
                  onChange={(e) => setMaxChats(Number(e.target.value))}
                  min={1}
                  max={1000}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="full" className="space-y-3 pt-3">
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-destructive">
                    Sync completo pode levar horas
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Sem cutoff de dias. Vai buscar todo histórico que o WhatsApp expõe. Consome cota Uazapi. Use apenas quando necessário.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="confirm_full"
                checked={confirmFull}
                onCheckedChange={(v) => setConfirmFull(!!v)}
              />
              <Label htmlFor="confirm_full" className="text-sm leading-tight">
                Entendo o impacto e quero importar todo o histórico.
              </Label>
            </div>
          </TabsContent>

          <TabsContent value="chat" className="space-y-3 pt-3">
            <div>
              <Label htmlFor="chat_jid">ID do chat (remote_jid)</Label>
              <Input
                id="chat_jid"
                placeholder="5511999999999@c.us"
                value={chatJid}
                onChange={(e) => setChatJid(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use o JID como aparece em <code className="px-1 bg-muted rounded">whatsapp_messages.remote_jid</code>.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createJob.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {createJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Iniciar import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
