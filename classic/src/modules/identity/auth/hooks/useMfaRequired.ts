/**
 * useMfaRequired — decide se a sessão atual precisa passar pelo segundo fator.
 *
 * Regra: **todo master precisa estar em aal2**. Não basta checar `nextLevel`,
 * que só vira 'aal2' para quem JÁ tem fator verificado — um master que nunca
 * cadastrou nada teria nextLevel 'aal1' e passaria direto pelo gate. Por isso a
 * condição é `currentLevel !== 'aal2'`: quem não tem fator é mandado para a
 * tela e cadastra; quem tem, é mandado para a tela e digita o código.
 *
 * O AAL sai do JWT que já está em memória (a chamada é assíncrona por contrato,
 * mas não vai à rede), e é reavaliado a cada evento de auth — inclusive o
 * refreshSession() que a tela de MFA dispara após verificar o código, que é o
 * que faz o gate liberar sem precisar de reload.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface MfaRequirement {
  /** Master ainda em aal1 — precisa cadastrar ou digitar o código. */
  required: boolean;
  /** AAL ainda não resolvido; não decida nada enquanto true. */
  isLoading: boolean;
}

export function useMfaRequired(isMaster: boolean, enabled = true): MfaRequirement {
  const [required, setRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!enabled || !isMaster) {
      setRequired(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const evaluate = async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) return;

      // Falha ao ler o AAL não pode virar porta aberta: exige o segundo fator.
      setRequired(error ? true : data?.currentLevel !== 'aal2');
      setIsLoading(false);
    };

    void evaluate();

    // Cobre login, refresh de token e o refreshSession() pós-verificação.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void evaluate();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [isMaster, enabled]);

  return { required, isLoading };
}
