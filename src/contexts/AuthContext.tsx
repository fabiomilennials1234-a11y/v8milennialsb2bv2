import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/** Chama a Edge Function para vincular o usuário à organização se o email estiver em pending_org_invites (pré-cadastro). */
async function attachToOrgByPendingInvite(accessToken: string): Promise<void> {
  if (!SUPABASE_URL?.trim()) return;
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/attach-to-org-by-pending-invite`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    if (data?.attached && data?.organization_id) {
      // Opcional: invalidar cache de team_members para refletir nova org
      window.dispatchEvent(new CustomEvent('auth:org-attached', { detail: { organization_id: data.organization_id } }));
    }
  } catch {
    // Silencioso: não quebrar login se a função falhar
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const attachCalledForSession = useRef<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.access_token && session?.user?.id) {
          const key = `${session.user.id}:${session.access_token.slice(0, 20)}`;
          if (attachCalledForSession.current !== key) {
            attachCalledForSession.current = key;
            attachToOrgByPendingInvite(session.access_token);
          }
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.access_token && session?.user?.id) {
        const key = `${session.user.id}:${session.access_token.slice(0, 20)}`;
        if (attachCalledForSession.current !== key) {
          attachCalledForSession.current = key;
          attachToOrgByPendingInvite(session.access_token);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
