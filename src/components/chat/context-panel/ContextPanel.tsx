/**
 * ContextPanel — painel de contexto 3ª coluna do ChatShell.
 *
 * Shell com Tabs (shadcn/ui) para 4 abas: Info, Pipe, Tags, Histórico.
 * Stubs agora; Onda 2b preenche com conteúdo real.
 *
 * Extraído como skeleton novo (C8) — não há código movido de WhatsAppChat.tsx.
 * Em produção (pré-Onda 2b), fica atrás de feature flag e não é montado.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextPanelInfo } from "./ContextPanelInfo";
import { ContextPanelPipe } from "./ContextPanelPipe";
import { ContextPanelTags } from "./ContextPanelTags";
import { ContextPanelHistory } from "./ContextPanelHistory";

export type ContextPanelTab = "info" | "pipe" | "tags" | "history";

export interface ContextPanelProps {
  leadId?: string;
  phoneNumber?: string;
  pushName?: string | null;
  defaultTab?: ContextPanelTab;
  onClose?: () => void;
}

export function ContextPanel({
  leadId,
  phoneNumber,
  pushName,
  defaultTab = "info",
}: ContextPanelProps) {
  return (
    <div className="flex flex-col h-full bg-background border-l border-border/60">
      <Tabs defaultValue={defaultTab} className="flex flex-col h-full">
        <div className="px-4 pt-3 shrink-0">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="info" className="text-xs">
              Info
            </TabsTrigger>
            <TabsTrigger value="pipe" className="text-xs">
              Pipe
            </TabsTrigger>
            <TabsTrigger value="tags" className="text-xs">
              Tags
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs">
              Histórico
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <TabsContent value="info" className="h-full mt-0">
            <ContextPanelInfo
              leadId={leadId}
              phoneNumber={phoneNumber}
              pushName={pushName}
            />
          </TabsContent>

          <TabsContent value="pipe" className="h-full mt-0">
            <ContextPanelPipe />
          </TabsContent>

          <TabsContent value="tags" className="h-full mt-0">
            <ContextPanelTags />
          </TabsContent>

          <TabsContent value="history" className="h-full mt-0">
            <ContextPanelHistory />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
