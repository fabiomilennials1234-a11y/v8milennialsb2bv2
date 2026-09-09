/**
 * MfaSetup — cadastro e verificação de TOTP (Google Authenticator e afins).
 *
 * Esta página vive FORA do gate de master de propósito. Ela só exige sessão
 * autenticada: nem master, nem org vinculada, nem aal2. Se ela ficasse atrás do
 * MasterRoute (que passará a exigir aal2), nasceria um deadlock — o master sem
 * fator nunca conseguiria cadastrar o primeiro, e ninguém mais entraria na área
 * master. Ver a rota em App.tsx: ProtectedRoute requireOrganization={false}.
 *
 * Expor o cadastro a qualquer usuário autenticado é seguro por construção: a
 * API `mfa.enroll()` age exclusivamente sobre a conta do próprio JWT — não há
 * parâmetro de usuário-alvo, então ninguém cadastra fator na conta de outro.
 *
 * Três estados, resolvidos na montagem a partir do AAL + fatores existentes:
 *   enroll    — sem fator verificado: mostra QR + chave manual
 *   challenge — tem fator, sessão ainda aal1: pede os 6 dígitos
 *   done      — sessão já é aal2
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Copy,
  Check,
  ArrowRight,
  KeyRound,
} from 'lucide-react';
import torqueLogo from '@/assets/torque-logo.png';

type Phase = 'loading' | 'enroll' | 'challenge' | 'done' | 'error';

/** Fator TOTP como devolvido por listFactors(). */
interface TotpFactor {
  id: string;
  status: string;
  friendly_name?: string;
}

const FRIENDLY_NAME = 'Torque CRM';

export default function MfaSetup() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  /**
   * Começa um cadastro novo. Remove antes qualquer fator não-verificado
   * pendente: enroll() falha com "friendly name already exists" se sobrar lixo
   * de uma tentativa anterior que o usuário abandonou no meio.
   */
  const startEnroll = useCallback(
    async (existing: TotpFactor[]) => {
      for (const stale of existing.filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: FRIENDLY_NAME,
      });

      if (error || !data) {
        setErrorMsg(error?.message ?? 'Não foi possível iniciar o cadastro.');
        setPhase('error');
        return;
      }

      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setPhase('enroll');
    },
    [],
  );

  /** Decide o estado inicial a partir do AAL da sessão e dos fatores da conta. */
  const resolvePhase = useCallback(async () => {
    const { data: aal, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalError) {
      setErrorMsg(aalError.message);
      setPhase('error');
      return;
    }

    if (aal?.currentLevel === 'aal2') {
      setPhase('done');
      return;
    }

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setErrorMsg(listError.message);
      setPhase('error');
      return;
    }

    const totp = (factors?.totp ?? []) as TotpFactor[];
    const verified = totp.find((f) => f.status === 'verified');

    if (verified) {
      // Já tem fator; falta só elevar esta sessão para aal2.
      setFactorId(verified.id);
      setPhase('challenge');
      return;
    }

    await startEnroll(totp);
  }, [startEnroll]);

  useEffect(() => {
    void resolvePhase();
  }, [resolvePhase]);

  /**
   * Confirma o código. Serve tanto para o cadastro (primeiro código valida o
   * fator) quanto para o desafio de login — challengeAndVerify cobre os dois e,
   * em ambos, promove a sessão a aal2.
   */
  const handleVerify = async () => {
    if (!factorId || code.length !== 6 || submitting) return;

    setSubmitting(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setSubmitting(false);

    if (error) {
      setCode('');
      toast({
        title: 'Código incorreto',
        description:
          'Confira os 6 dígitos no app autenticador. O código troca a cada 30 segundos.',
        variant: 'destructive',
      });
      return;
    }

    // A sessão foi reemitida com aal2 — sem refresh a UI seguiria vendo aal1.
    await supabase.auth.refreshSession();
    setPhase('done');
    toast({
      title: 'Verificação em duas etapas ativa',
      description: 'Esta sessão está protegida.',
    });
  };

  // Envia sozinho quando o sexto dígito entra — ninguém precisa clicar.
  useEffect(() => {
    if (code.length === 6 && !submitting) void handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const copySecret = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (phase === 'loading') {
    return (
      <MfaLayout>
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verificando sua conta...</p>
        </div>
      </MfaLayout>
    );
  }

  if (phase === 'error') {
    return (
      <MfaLayout>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Não foi possível continuar</h3>
            <p className="text-sm text-muted-foreground mt-2">
              {errorMsg ?? 'Tente novamente em instantes.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar de novo
          </Button>
        </div>
      </MfaLayout>
    );
  }

  if (phase === 'done') {
    return (
      <MfaLayout>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Tudo certo</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Sua conta está com verificação em duas etapas. A cada login o Torque vai
              pedir os 6 dígitos do app autenticador.
            </p>
          </div>
          <Button className="mt-2" onClick={() => navigate('/', { replace: true })}>
            Ir para o sistema
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </MfaLayout>
    );
  }

  const isEnroll = phase === 'enroll';

  return (
    <MfaLayout>
      <div className="text-center mb-6">
        <div className="w-12 h-12 mx-auto rounded-xl bg-primary/10 flex items-center justify-center mb-4">
          <KeyRound className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">
          {isEnroll ? 'Ative a verificação em duas etapas' : 'Confirme que é você'}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {isEnroll
            ? 'Escaneie o código no Google Authenticator, Authy ou 1Password e digite os 6 dígitos que aparecerem.'
            : 'Digite os 6 dígitos que estão no seu app autenticador.'}
        </p>
      </div>

      {isEnroll && qrCode && (
        <div className="space-y-4 mb-6">
          <div className="bg-white rounded-lg p-4 w-fit mx-auto border border-border">
            <img src={qrCode} alt="QR code para o app autenticador" className="w-44 h-44" />
          </div>

          {secret && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground text-center">
                Não consegue escanear? Cadastre esta chave manualmente:
              </p>
              <button
                type="button"
                onClick={copySecret}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs tracking-wider text-foreground transition-colors hover:bg-muted"
              >
                {secret}
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-4">
        <InputOTP maxLength={6} value={code} onChange={setCode} disabled={submitting} autoFocus>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>

        {submitting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verificando...
          </p>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Perdeu o acesso ao app autenticador? Fale com outro master para remover o fator.
      </p>
    </MfaLayout>
  );
}

function MfaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-6">
          <Link to="/">
            <img src={torqueLogo} alt="Torque CRM" className="h-10 mx-auto object-contain" />
          </Link>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">{children}</div>
      </motion.div>
    </div>
  );
}
