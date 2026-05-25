// src/hooks/chat-meta/useMetaRealtime.ts
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";

export function useMetaRealtime() {
  const qc = useQueryClient();

  useRealtimeSubscription("meta_conversations", ["meta_conversations"]);
  useRealtimeSubscription("channel_messages", ["meta_messages"]);

  // Optional: invalidate active meta_messages keys when a new channel_messages
  // row of channel messenger/instagram lands — useRealtimeSubscription debounces
  // and invalidates the full meta_messages key set above.
  useEffect(() => {
    return () => {
      qc.cancelQueries({ queryKey: ["meta_conversations"] });
      qc.cancelQueries({ queryKey: ["meta_messages"] });
    };
  }, [qc]);
}
