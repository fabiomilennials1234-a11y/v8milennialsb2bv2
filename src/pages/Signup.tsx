import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2, Zap, Shield, TrendingUp } from 'lucide-react';
import torqueLogo from '@/assets/torque-logo.png';
import { validatePassword } from '@/lib/password-validation';

// ─── Mask helpers ────────────────────────────────────────────────────────────

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    // (XX) XXXX-XXXX
    return digits
      .replace(/^(\d{2})/, '($1) ')
      .replace(/(\) \d{4})(\d)/, '$1-$2');
  }
  // (XX) XXXXX-XXXX
  return digits
    .replace(/^(\d{2})/, '($1) ')
    .replace(/(\) \d{5})(\d)/, '$1-$2');
}

function maskCpfCnpj(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  // CNPJ: 00.000.000/0000-00
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidDocument(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Signup() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');

  // form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [document, setDocument] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ui state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgCheckDone, setOrgCheckDone] = useState(false);

  // ── Redirect if already authenticated ────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setOrgCheckDone(true);
      return;
    }

    // Check if authenticated user already has an active org
    async function checkOrg() {
      try {
        const { data } = await supabase
          .from('team_members')
          .select('organization_id, is_active')
          .eq('user_id', user!.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (data?.organization_id) {
          navigate('/dashboard', { replace: true });
        } else {
          // Authenticated but no org → go straight to checkout
          const dest = planParam ? `/checkout?plan=${planParam}` : '/checkout';
          navigate(dest, { replace: true });
        }
      } catch {
        // Fail open: let them proceed
        setOrgCheckDone(true);
      }
    }

    checkOrg();
  }, [user, authLoading, navigate, planParam]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!name.trim()) {
      setError('Por favor, informe seu nome completo.');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Informe um e-mail válido.');
      return;
    }
    const pwResult = validatePassword(password);
    if (!pwResult.valid) {
      setError(pwResult.message);
      return;
    }
    if (document && !isValidDocument(document)) {
      setError('CPF deve ter 11 dígitos e CNPJ deve ter 14 dígitos.');
      return;
    }

    setLoading(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          phone: phone.replace(/\D/g, ''),
          document: document.replace(/\D/g, ''),
          // subscription_status is set server-side by a DB trigger on auth.users
          // to prevent client-side paywall bypass.
        },
      },
    });

    setLoading(false);

    if (signUpError) {
      if (signUpError.message.toLowerCase().includes('already registered')) {
        setError('Este e-mail já está cadastrado. Faça login ou recupere sua senha.');
      } else {
        setError(signUpError.message);
      }
      return;
    }

    const dest = planParam ? `/checkout?plan=${planParam}` : '/checkout';
    navigate(dest, { replace: true });
  }

  // While auth state is loading, or redirect is in progress, show nothing
  if (authLoading || (user && !orgCheckDone)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* ── Left panel — branding ───────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col"
        style={{
          background:
            'linear-gradient(160deg, hsl(36 20% 8%) 0%, hsl(30 25% 12%) 50%, hsl(36 20% 8%) 100%)',
        }}
      >
        {/* Ambient orange glow */}
        <div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{
            background:
              'radial-gradient(circle, hsl(31 85% 53% / 0.12) 0%, transparent 70%)',
            transform: 'translate(20%, -20%)',
          }}
        />
        {/* Racing stripe accent */}
        <div className="absolute left-0 top-0 w-[3px] h-full bg-primary/40" />
        <div className="absolute left-[6px] top-0 w-[1px] h-full bg-primary/20" />
        {/* Subtle checkered texture */}
        <div className="absolute inset-0 checkered-pattern opacity-[0.02] pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between p-14 h-full">
          {/* Logo */}
          <motion.img
            src={torqueLogo}
            alt="Torque CRM"
            className="h-12 object-contain object-left"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          />

          {/* Headline */}
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.55 }}
            >
              <p
                className="text-sm font-semibold uppercase tracking-[0.2em] mb-4"
                style={{ color: 'hsl(31 85% 53%)' }}
              >
                Comece agora
              </p>
              <h1
                className="text-[3.25rem] font-black leading-[1.05]"
                style={{ letterSpacing: '-0.04em', color: 'hsl(45 20% 92%)' }}
              >
                Acelere suas
                <br />
                <span className="text-gradient-primary">vendas hoje.</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35, duration: 0.5 }}
              className="text-lg leading-relaxed max-w-sm"
              style={{ color: 'hsl(45 15% 58%)' }}
            >
              Crie sua conta em segundos e comece a gerenciar sua equipe
              comercial com precisão de engenharia.
            </motion.p>

            {/* Feature pills */}
            <motion.div
              className="flex flex-col gap-3 pt-2"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              {[
                { icon: Zap, text: 'Pipeline visual e automações de alta performance' },
                { icon: TrendingUp, text: 'Rankings, metas e comissões em tempo real' },
                { icon: Shield, text: 'Dados seguros com criptografia de ponta a ponta' },
              ].map((feat, i) => (
                <motion.div
                  key={feat.text}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
                    style={{ background: 'hsl(31 85% 53% / 0.15)', border: '1px solid hsl(31 85% 53% / 0.25)' }}
                  >
                    <feat.icon className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'hsl(45 15% 65%)' }}>
                    {feat.text}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'hsl(45 10% 32%)' }}>
            <span>Torque CRM</span>
            <span>·</span>
            <span>&copy; {new Date().getFullYear()}</span>
            <span>·</span>
            <Link
              to="/privacidade"
              className="underline underline-offset-2 hover:text-[hsl(45_10%_48%)] transition-colors"
            >
              Privacidade
            </Link>
          </div>
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative overflow-y-auto">
        {/* Subtle bg glow on form side */}
        <div
          className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full pointer-events-none opacity-30"
          style={{
            background:
              'radial-gradient(circle, hsl(31 85% 53% / 0.08) 0%, transparent 70%)',
            transform: 'translate(-30%, 30%)',
          }}
        />

        <motion.div
          className="relative z-10 w-full max-w-[440px]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center justify-center">
              <img src={torqueLogo} alt="Torque CRM" className="h-10 object-contain" />
            </div>
          </div>

          {/* Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-lg dark:shadow-none dark:ring-1 dark:ring-border">
            <div className="mb-7">
              <h2
                className="text-2xl font-black mb-1.5"
                style={{ letterSpacing: '-0.03em', color: 'hsl(45 20% 95%)' }}
              >
                Criar sua conta
              </h2>
              <p className="text-sm text-muted-foreground">
                {planParam
                  ? `Plano selecionado: ${planParam} — finalize o cadastro para prosseguir.`
                  : 'Preencha os dados abaixo para começar.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Nome completo */}
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium">
                  Nome completo
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  disabled={loading}
                  className="h-11"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium">
                  E-mail
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={loading}
                  className="h-11"
                />
              </div>

              {/* Telefone */}
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Telefone
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                  autoComplete="tel"
                  disabled={loading}
                  className="h-11"
                  inputMode="numeric"
                />
              </div>

              {/* CPF / CNPJ */}
              <div className="space-y-1.5">
                <Label htmlFor="document" className="text-sm font-medium">
                  CPF / CNPJ
                </Label>
                <Input
                  id="document"
                  type="text"
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  value={document}
                  onChange={(e) => setDocument(maskCpfCnpj(e.target.value))}
                  disabled={loading}
                  className="h-11"
                  inputMode="numeric"
                />
                <p className="text-xs text-muted-foreground/70">
                  Detectado automaticamente: {document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ'}
                </p>
              </div>

              {/* Senha */}
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Mínimo 12 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={12}
                    disabled={loading}
                    className="h-11 pr-11"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Inline error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3 leading-snug"
                >
                  {error}
                </motion.div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-12 gradient-primary gradient-primary-hover text-white font-semibold border-0 mt-2"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Criar conta e continuar'
                )}
              </Button>
            </form>

            {/* Footer link */}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Já tem conta?{' '}
              <Link
                to="/auth"
                className="text-primary font-semibold hover:underline underline-offset-4 transition-colors"
              >
                Faça login
              </Link>
            </p>
          </div>

          {/* Privacy */}
          <p className="text-center text-xs text-muted-foreground/40 mt-5">
            <Link
              to="/privacidade"
              className="hover:text-muted-foreground transition-colors underline underline-offset-2"
            >
              Política de Privacidade
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
