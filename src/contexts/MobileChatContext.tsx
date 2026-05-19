import { createContext, useContext, useState, type ReactNode } from "react";

interface MobileChatContextValue {
  isChatThreadOpen: boolean;
  setChatThreadOpen: (open: boolean) => void;
}

const MobileChatContext = createContext<MobileChatContextValue>({
  isChatThreadOpen: false,
  setChatThreadOpen: () => {},
});

export function MobileChatProvider({ children }: { children: ReactNode }) {
  const [isChatThreadOpen, setChatThreadOpen] = useState(false);
  return (
    <MobileChatContext.Provider value={{ isChatThreadOpen, setChatThreadOpen }}>
      {children}
    </MobileChatContext.Provider>
  );
}

export function useMobileChatContext() {
  return useContext(MobileChatContext);
}
