import { useEffect, useMemo, useState } from "react";
import { contactKey, type InboxContact } from "./types";
import { selectableConversations } from "../../lib/conversationBatch";

export function useConversationSelection(scope: string, contacts: readonly InboxContact[], enabled: boolean) {
  const [state, setState] = useState({ scope, revision: 0, selecting: false, busy: false, keys: new Set<string>() });
  // Reset synchronously: no frame exposes the previous org/filter's selection.
  if (state.scope !== scope) {
    setState({ scope, revision: state.revision + 1, selecting: false, busy: false, keys: new Set() });
  }
  const eligible = useMemo(() => enabled ? selectableConversations(contacts) : [], [contacts, enabled]);
  const visible = useMemo(() => new Set(eligible.map(contactKey)), [eligible]);
  const selected = eligible.filter(c => state.keys.has(contactKey(c)));
  useEffect(() => {
    setState(previous => {
      const keys = new Set([...previous.keys].filter(key => visible.has(key)));
      return keys.size === previous.keys.size ? previous : { ...previous, keys };
    });
  }, [visible]);
  // A previous batch may finish after navigation. Its callbacks cannot modify
  // a newer selection, even after switching away and back to the same filter.
  const update = (patch: Partial<typeof state>) => setState(previous =>
    previous.scope === scope && previous.revision === state.revision ? { ...previous, ...patch } : previous,
  );
  return {
    eligible, selected,
    selecting: enabled && state.selecting,
    busy: state.busy,
    revision: state.revision,
    setSelecting: (selecting: boolean) => update({ selecting }),
    setSelection: (keys: Set<string>) => update({ keys }),
    setBusy: (busy: boolean) => update({ busy }),
    toggle: (key: string) => {
      if (state.busy || !visible.has(key)) return;
      const keys = new Set(state.keys);
      if (keys.has(key)) keys.delete(key); else keys.add(key);
      update({ keys });
    },
  };
}
