// src/components/chat-meta/MetaChatHeader.tsx
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MetaChannel, MetaPagesByChannel } from "@/modules/communication/hooks/chat-meta/types";

interface Props {
  byChannel: MetaPagesByChannel;
  channel: MetaChannel;
  onChannelChange: (c: MetaChannel) => void;
  pageId: string | null;
  onPageChange: (id: string) => void;
}

export function MetaChatHeader({ byChannel, channel, onChannelChange, pageId, onPageChange }: Props) {
  const pages = byChannel[channel];
  const showChannelTabs = byChannel.messenger.length > 0 && byChannel.instagram.length > 0;

  return (
    <div className="flex items-center gap-3 border-b px-4 py-3">
      {showChannelTabs && (
        <Tabs value={channel} onValueChange={(v) => onChannelChange(v as MetaChannel)}>
          <TabsList>
            <TabsTrigger value="messenger">Messenger</TabsTrigger>
            <TabsTrigger value="instagram">Instagram</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {pages.length > 1 && (
        <Select value={pageId ?? undefined} onValueChange={onPageChange}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Selecione uma página" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{channel === "instagram" ? "Contas Instagram" : "Páginas Facebook"}</SelectLabel>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.instagram_username ? `@${p.instagram_username}` : p.page_name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}

      {pages.length === 1 && (
        <span className="text-sm text-muted-foreground">
          {pages[0].instagram_username ? `@${pages[0].instagram_username}` : pages[0].page_name}
        </span>
      )}
    </div>
  );
}
