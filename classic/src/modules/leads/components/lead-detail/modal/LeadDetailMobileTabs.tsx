import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface LeadDetailMobileTabsProps {
  infoContent: ReactNode;
  historyContent: ReactNode;
  chatContent: ReactNode;
  leadPhone: string | null;
}

export function LeadDetailMobileTabs({
  infoContent,
  historyContent,
  chatContent,
  leadPhone,
}: LeadDetailMobileTabsProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Drag handle */}
      <div className="flex justify-center pt-2 pb-1" data-testid="mobile-drag-handle">
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info" className="flex flex-col flex-1 min-h-0">
        <TabsList className="px-4 shrink-0">
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="flex-1 min-h-0 overflow-y-auto mt-0">
          {infoContent}
        </TabsContent>
        <TabsContent value="historico" className="flex-1 min-h-0 overflow-y-auto mt-0">
          {historyContent}
        </TabsContent>
        <TabsContent value="chat" className="flex-1 min-h-0 overflow-y-auto mt-0">
          {chatContent}
        </TabsContent>
      </Tabs>

      {/* CTA sticky bottom */}
      {leadPhone && (
        <div className="shrink-0 border-t border-border/40 p-3 bg-card">
          <Button
            className="w-full gap-2"
            onClick={() => navigate("/chat-whatsapp")}
          >
            <MessageCircle className="w-4 h-4" />
            Abrir conversa
          </Button>
        </div>
      )}
    </div>
  );
}
