import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Lock, ArrowRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import torqueLogo from '@/assets/torque-logo.png';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Wait for Supabase to process the recovery token from the URL hash
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Also check if we already have a session (e.g., if the event fired before mount)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      }
    });

    // Timeout: if no recovery session after 5 seconds, show error
    const timeout = setTimeout(() => {
      setSessionReady((ready) => {
        if (!ready) setSessionError(true);
        return ready;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({ title: 'Senha muito curta', description: 'A senha deve ter pelo menos 6 caracteres.', variant: 'destructive' });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: 'Senhas nao conferem', description: 'A confirmacao de senha deve ser igual a nova senha.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast({ title: 'Erro ao redefinir senha', description: error.message, variant: 'destructive' });
      } else {
        setSuccess(true);
        toast({ title: 'Senha redefinida!', description: 'Sua senha foi alterada com sucesso.' });
      }
    } catch {
      toast({ title: 'Erro inesperado', description: 'Tente novamente mais tarde.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (success) {
    return (
      <ResetPasswordLayout>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Senha redefinida!</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Sua senha foi alterada com sucesso. Voce ja pode acessar o sistema.
            </p>
          </div>
          <Button
            className="w-full gradient-primary gradient-primary-hover text-white font-semibold h-12 border-0 mt-4"
            onClick={() => navigate('/dashboard')}
          >
            Acessar o sistema
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </ResetPasswordLayout>
    );
  }

  // Error state — invalid or expired link
  if (sessionError && !sessionReady) {
    return (
      <ResetPasswordLayout>
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Link invalido ou expirado</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Este link de recuperacao nao e mais valido. Solicite um novo link na tela de login.
            </p>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => navigate('/auth')}
          >
            Voltar ao login
          </Button>
        </div>
      </ResetPasswordLayout>
    );
  }

  // Loading state — waiting for recovery session
  if (!sessionReady) {
    return (
      <ResetPasswordLayout>
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verificando link de recuperacao...</p>
        </div>
      </ResetPasswordLayout>
    );
  }

  // Form state — ready to reset
  return (
    <ResetPasswordLayout>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-foreground">Nova senha</h2>
        <p className="text-muted-foreground mt-2">
          Defina sua nova senha para acessar o sistema
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
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
              minLength={6}
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">Minimo de 6 caracteres</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar senha</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10"
              required
              minLength={6}
            />
          </div>
          {confirmPassword && password !== confirmPassword && (
            <p className="text-xs text-destructive">As senhas nao conferem</p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full gradient-primary gradient-primary-hover text-white font-semibold h-12 border-0"
          disabled={loading || password !== confirmPassword || password.length < 6}
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              Redefinir senha
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </ResetPasswordLayout>
  );
}

function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-6">
          <Link to="/auth">
            <img src={torqueLogo} alt="Torque CRM" className="h-10 mx-auto object-contain" />
          </Link>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
