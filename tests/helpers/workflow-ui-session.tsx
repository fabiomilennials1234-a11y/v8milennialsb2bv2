import React, { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/modules/identity/auth/contexts/AuthContext";
import type { User } from "@supabase/supabase-js";

export function WorkflowUiSession({ children, userId = null }: { children: ReactNode; userId?: string | null }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  const value = { user: userId ? { id: userId } as User : null, session: null, loading: false,
    signIn: async () => ({ error: null }), signUp: async () => ({ error: null }), signOut: async () => {} };
  return <QueryClientProvider client={client}><AuthContext.Provider value={value}>{children}</AuthContext.Provider></QueryClientProvider>;
}
