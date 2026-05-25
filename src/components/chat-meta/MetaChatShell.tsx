// src/components/chat-meta/MetaChatShell.tsx
//
// Shell composing the Meta (Messenger/Instagram) chat experience:
// header (channel + page selector) on top, then the 3-col ChatShell
// (list / view / context) below.
//
// Note: `ChatShell` does NOT accept a `header` slot — its real prop
// shape is `{ list, view, context?, selectedPhone, onBack, ... }`.
// So we host the header in a vertical flex wrapper above ChatShell
// and map our `selectedConvId` onto `selectedPhone` to keep the
// mobile-collapse behaviour (left column hides when a conversation
// is selected on <md viewports).
import { useState, useEffect, useMemo } from "react";
import { ChatShell } from "@/components/chat/layout/ChatShell";
import { useMetaPages } from "@/hooks/chat-meta/useMetaPages";
import { useMetaConversations } from "@/hooks/chat-meta/useMetaConversations";
import { useMetaRealtime } from "@/hooks/chat-meta/useMetaRealtime";
import { useMetaConversationProfile } from "@/hooks/chat-meta/useMetaConversationProfile";
import { MetaChatHeader } from "./MetaChatHeader";
import { MetaConversationList } from "./MetaConversationList";
import { MetaMessageList } from "./MetaMessageList";
import { MetaComposer } from "./MetaComposer";
import { MetaWindowWarning } from "./MetaWindowWarning";
import { LinkLeadDialog } from "./LinkLeadDialog";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";
import type { MetaChannel } from "@/hooks/chat-meta/types";

export function MetaChatShell() {
  useMetaRealtime();
  const { data: pagesData } = useMetaPages();
  const [channel, setChannel] = useState<MetaChannel>("messenger");
  const [pageId, setPageId] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const profileMutate = useMetaConversationProfile();

  // default channel = first with pages
  useEffect(() => {
    if (!pagesData) return;
    if (pagesData.byChannel.messenger.length > 0) {
      setChannel("messenger");
      setPageId(pagesData.byChannel.messenger[0].id);
    } else if (pagesData.byChannel.instagram.length > 0) {
      setChannel("instagram");
      setPageId(pagesData.byChannel.instagram[0].id);
    }
  }, [pagesData]);

  // when channel changes, reset page selection to first of channel
  useEffect(() => {
    if (!pagesData) return;
    const list = pagesData.byChannel[channel];
    if (list.length > 0) setPageId(list[0].id);
  }, [channel, pagesData]);

  const { data: conversations } = useMetaConversations({
    pageId,
    channel,
    tab: "active",
  });
  const selectedConv = useMemo(
    () => conversations?.find((c) => c.id === selectedConvId) ?? null,
    [conversations, selectedConvId],
  );

  // on selection, ensure profile cached
  useEffect(() => {
    if (selectedConv && !selectedConv.external_username) {
      profileMutate.mutate(selectedConv.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConvId]);

  if (!pagesData) return null;

  return (
    <>
      <div className="flex h-full w-full flex-col">
        <MetaChatHeader
          byChannel={pagesData.byChannel}
          channel={channel}
          onChannelChange={setChannel}
          pageId={pageId}
          onPageChange={setPageId}
        />
        <div className="min-h-0 flex-1">
          <ChatShell
            selectedPhone={selectedConvId}
            onBack={() => setSelectedConvId(null)}
            list={
              <MetaConversationList
                pageId={pageId}
                channel={channel}
                selectedConversationId={selectedConvId}
                onSelect={setSelectedConvId}
              />
            }
            view={
              <div className="flex h-full flex-col">
                {selectedConv && (
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <div className="text-sm font-medium">
                      {selectedConv.external_username ?? "Usuário"}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLinkOpen(true)}
                    >
                      <Link2 className="mr-1 h-3 w-3" />
                      {selectedConv.lead_id ? "Trocar lead" : "Vincular lead"}
                    </Button>
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <MetaMessageList conversationId={selectedConvId} />
                </div>
                {selectedConv && (
                  <>
                    <MetaWindowWarning
                      lastInboundAt={selectedConv.last_inbound_at}
                    />
                    <MetaComposer
                      conversationId={selectedConv.id}
                      lastInboundAt={selectedConv.last_inbound_at}
                    />
                  </>
                )}
              </div>
            }
            context={null}
          />
        </div>
      </div>

      {selectedConvId && (
        <LinkLeadDialog
          conversationId={selectedConvId}
          open={linkOpen}
          onOpenChange={setLinkOpen}
        />
      )}
    </>
  );
}
