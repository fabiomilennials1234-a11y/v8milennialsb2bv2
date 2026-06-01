import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, User, ArrowRight, ArrowLeft, Loader2, Flag, Fuel, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import torqueLogo from '@/assets/torque-logo.png';
import { validatePassword } from '@/lib/password-validation';

type AuthMode = 'login' | 'signup' | 'forgot';

export default function Auth() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const isLogin = mode === 'login';
  const isForgot = mode === 'forgot';

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: 'Informe seu e-mail', description: 'Digite o e-mail cadastrado para receber o link.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (error) {
        toast({ title: 'Erro ao enviar e-mail', description: error.message, variant: 'destructive' });
      } else {
        setResetEmailSent(true);
        toast({ title: 'E-mail enviado', description: 'Verifique sua caixa de entrada para redefinir a senha.' });
      }
    } catch {
      toast({ title: 'Erro inesperado', description: 'Tente novamente mais tarde.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast({
              title: 'Credenciais inválidas',
              description: 'E-mail ou senha incorretos. Verifique e tente novamente.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Erro ao entrar',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Bem-vindo de volta! ⚡',
            description: 'Login realizado com sucesso.',
          });
          navigate('/');
        }
      } else {
        if (!fullName.trim()) {
          toast({
            title: 'Nome obrigatório',
            description: 'Por favor, informe seu nome completo.',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        const pwResult = validatePassword(password);
        if (!pwResult.valid) {
          toast({
            title: 'Senha fraca',
            description: pwResult.message,
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        const { error } = await signUp(email, password, fullName);
        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'Verifique seu e-mail',
              description: 'Se este e-mail estiver cadastrado, verifique sua caixa de entrada. Caso contrário, tente novamente.',
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Erro ao criar conta',
              description: error.message,
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Bem-vindo ao Torque! 🏁',
            description: 'Hora de acelerar suas vendas.',
          });
          navigate('/');
        }
      }
    } catch (err) {
      toast({
        title: 'Erro inesperado',
        description: 'Tente novamente mais tarde.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex overflow-hidden">
      {/* Left Panel - V8 Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden" style={{ background: 'linear-gradient(160deg, hsl(36 20% 8%) 0%, hsl(36 20% 14%) 50%, hsl(36 20% 8%) 100%)' }}>
        {/* Racing stripe accent */}
        <div className="absolute left-0 top-0 w-[3px] h-full bg-primary/40" />
        <div className="absolute left-[6px] top-0 w-[1px] h-full bg-primary/20" />

        {/* Checkered pattern — subtle brand texture */}
        <div className="absolute inset-0 checkered-pattern opacity-[0.025] pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <motion.img
              src={torqueLogo}
              alt="Torque CRM"
              className="h-14 object-contain"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
            />
          </div>

          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              <h1 className="text-5xl font-black leading-tight" style={{ letterSpacing: '-0.04em', color: 'hsl(45 20% 90%)' }}>
                CRM de Vendas
                <br />
                <span className="text-gradient-primary">Alta Performance</span>
              </h1>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="text-lg max-w-md leading-relaxed"
              style={{ color: 'hsl(45 15% 60%)' }}
            >
              Acelere suas vendas com um sistema de alta performance.
              Cada lead é uma oportunidade, cada vendedor é um campeão.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-wrap items-center gap-3 pt-4"
            >
              {[
                { icon: Flag, text: 'Central de Comando' },
                { icon: Fuel, text: 'Leads = Combustível' },
                { icon: Trophy, text: 'Pilotos no Pódio' },
              ].map((feature, i) => (
                <motion.div
                  key={feature.text}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'hsl(36 15% 22%)', background: 'hsl(36 15% 12%)' }}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <feature.icon className="w-4 h-4 text-primary/70" />
                  <span className="text-sm font-medium" style={{ color: 'hsl(45 15% 70%)' }}>{feature.text}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="flex items-center gap-2 text-sm flex-wrap" style={{ color: 'hsl(45 10% 35%)' }}>
            <span>Torque CRM</span>
            <span className="mx-1">·</span>
            <span>&copy; {new Date().getFullYear()}</span>
            <span className="mx-1">·</span>
            <Link
              to="/privacidade"
              className="underline underline-offset-2 transition-colors hover:text-[hsl(45_10%_50%)]"
            >
              Privacidade
            </Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center gap-3 px-4 py-3 bg-sidebar-background rounded-xl">
              <img src={torqueLogo} alt="Torque CRM" className="h-10 object-contain drop-shadow-lg" />
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                {isForgot ? 'Recuperar senha' : isLogin ? 'Acelere para a pista' : 'Entre para a equipe'}
              </h2>
              <p className="text-muted-foreground mt-2">
                {isForgot
                  ? 'Informe seu e-mail para receber o link de redefinicao'
                  : isLogin
                    ? 'Acesse a Central de Comando Torque'
                    : 'Junte-se aos pilotos de alta performance'}
              </p>
            </div>

            {/* Forgot password mode */}
            {isForgot ? (
              resetEmailSent ? (
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                    <Mail className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">E-mail enviado!</h3>
                    <p className="text-sm text-muted-foreground mt-2">
                      Se o e-mail <strong>{email}</strong> estiver cadastrado, voce recebera um link para redefinir sua senha.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Verifique tambem a pasta de spam.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => { setMode('login'); setResetEmailSent(false); }}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar ao login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full gradient-primary gradient-primary-hover text-white font-semibold h-12 border-0"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        Enviar link de recuperacao
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="w-3 h-3 inline mr-1" />
                      Voltar ao login
                    </button>
                  </div>
                </form>
              )
            ) : (
              /* Login / Signup mode */
              <>
                <form onSubmit={handleSubmit} className="space-y-5">
                  {!isLogin && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <Label htmlFor="fullName">Nome completo</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="fullName"
                          type="text"
                          placeholder="Seu nome completo"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="pl-10"
                          required={!isLogin}
                        />
                      </div>
                    </motion.div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Senha</Label>
                      {isLogin && (
                        <button
                          type="button"
                          onClick={() => setMode('forgot')}
                          className="text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                          Esqueci minha senha
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                        minLength={isLogin ? undefined : 12}
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full gradient-primary gradient-primary-hover text-white font-semibold h-12 border-0"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        {isLogin ? 'Entrar' : 'Criar conta'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setMode(isLogin ? 'signup' : 'login')}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isLogin ? (
                      <>
                        Nao tem conta?{' '}
                        <span className="text-primary font-medium">Cadastre-se</span>
                      </>
                    ) : (
                      <>
                        Ja tem conta?{' '}
                        <span className="text-primary font-medium">Faca login</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground/50 mt-6">
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
