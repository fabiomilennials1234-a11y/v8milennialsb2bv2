import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import torqueLogo from '@/assets/torque-logo.png';
import torqueHexagons from '@/assets/torque-hexagons.png';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

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

        const { error } = await signUp(email, password, fullName);
        if (error) {
          if (error.message.includes('already registered')) {
            toast({
              title: 'E-mail já cadastrado',
              description: 'Este e-mail já está em uso. Tente fazer login.',
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
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-sidebar-background via-sidebar-accent to-sidebar-background relative overflow-hidden">
        {/* Hexagonal background pattern */}
        <motion.img
          src={torqueHexagons}
          alt=""
          className="absolute -bottom-[8%] right-[2%] w-[50%] opacity-[0.12] pointer-events-none select-none -rotate-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.12 }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
        <motion.img
          src={torqueHexagons}
          alt=""
          className="absolute top-[18%] left-[62%] w-[30%] opacity-[0.08] pointer-events-none select-none rotate-[160deg]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.08 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.15 }}
        />
        
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <motion.img
              src={torqueLogo}
              alt="Torque CRM"
              className="h-16 object-contain drop-shadow-lg"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, type: "spring" }}
            />
          </div>
          
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              <h1 className="text-5xl font-black text-sidebar-foreground leading-tight">
                CRM de Vendas
                <br />
                <span className="text-gradient-primary">Alta Performance</span>
              </h1>
            </motion.div>
            
            <motion.p
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-sidebar-foreground/70 text-lg max-w-md"
            >
              Acelere suas vendas com um sistema de alta performance.
              Cada lead é uma oportunidade, cada vendedor é um campeão.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-wrap items-center gap-4 pt-4"
            >
              {[
                { icon: '🏁', text: 'Central de Comando' },
                { icon: '⛽', text: 'Leads = Combustível' },
                { icon: '🏆', text: 'Pilotos no Pódio' },
              ].map((feature, i) => (
                <motion.div 
                  key={feature.text} 
                  className="flex items-center gap-2 bg-sidebar-accent/50 px-3 py-2 rounded-full"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                >
                  <span className="text-lg">{feature.icon}</span>
                  <span className="text-sm font-medium text-sidebar-foreground/80">{feature.text}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>

          <div className="flex items-center gap-2 text-sidebar-foreground/40 text-sm flex-wrap">
            <span>⚙️</span>
            <span>Torque CRM</span>
            <span className="mx-2">•</span>
            <span>© {new Date().getFullYear()} Torque</span>
            <span className="mx-2">•</span>
            <Link
              to="/privacidade"
              className="hover:text-sidebar-foreground/70 transition-colors underline underline-offset-2"
            >
              Política de Privacidade
            </Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        {/* Subtle hexagonal decorations */}
        <motion.img
          src={torqueHexagons}
          alt=""
          className="absolute -top-[8%] -right-[8%] w-[40%] opacity-[0.04] pointer-events-none select-none rotate-[55deg]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.04 }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
        />
        <motion.img
          src={torqueHexagons}
          alt=""
          className="absolute -bottom-[10%] -right-[5%] w-[45%] opacity-[0.04] pointer-events-none select-none -rotate-[110deg]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.04 }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
        />
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

          <div className="glass-card p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                {isLogin ? 'Acelere para a pista' : 'Entre para a equipe'}
              </h2>
              <p className="text-muted-foreground mt-2">
                {isLogin 
                  ? 'Acesse a Central de Comando Torque'
                  : 'Junte-se aos pilotos de alta performance'}
              </p>
            </div>

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
                <Label htmlFor="password">Senha</Label>
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
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {isLogin ? (
                  <>
                    Não tem conta?{' '}
                    <span className="text-primary font-medium">Cadastre-se</span>
                  </>
                ) : (
                  <>
                    Já tem conta?{' '}
                    <span className="text-primary font-medium">Faça login</span>
                  </>
                )}
              </button>
            </div>
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
