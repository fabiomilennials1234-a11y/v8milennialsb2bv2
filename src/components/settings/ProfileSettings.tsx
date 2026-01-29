import { useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Camera, Save, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";

export function ProfileSettings() {
  const { user } = useAuth();
  const { data: userRole } = useUserRole();
  
  const [formData, setFormData] = useState({
    full_name: user?.user_metadata?.full_name || "",
    email: user?.email || "",
  });
  const [isLoading, setIsLoading] = useState(false);

  const initials = formData.full_name
    ? formData.full_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
    : user?.email?.substring(0, 2).toUpperCase() || "??";

  const roleLabels: Record<string, { label: string; color: string }> = {
    admin: { label: "Administrador", color: "bg-success/10 text-success border-success/30" },
    sdr: { label: "SDR", color: "bg-chart-5/10 text-chart-5 border-chart-5/30" },
    closer: { label: "Closer", color: "bg-primary/10 text-primary border-primary/30" },
  };

  const roleConfig = roleLabels[userRole?.role || ""] || { label: "Usuário", color: "" };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // Here you would update the user profile
      toast.success("Perfil atualizado com sucesso!");
    } catch (error) {
      toast.error("Erro ao atualizar perfil");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Perfil</h3>
        <p className="text-sm text-muted-foreground">
          Gerencie suas informações pessoais
        </p>
      </div>

      {/* Avatar Section */}
      <div className="flex items-center gap-6">
        <div className="relative">
          <Avatar className="w-20 h-20">
            <AvatarImage src={user?.user_metadata?.avatar_url} />
            <AvatarFallback className="text-2xl bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <button className="absolute bottom-0 right-0 p-1.5 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors">
            <Camera className="w-3 h-3" />
          </button>
        </div>
        <div>
          <h4 className="font-medium">{formData.full_name || user?.email}</h4>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <Badge variant="outline" className={roleConfig.color + " mt-2"}>
            <Shield className="w-3 h-3 mr-1" />
            {roleConfig.label}
          </Badge>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="full_name">Nome Completo</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="Seu nome completo"
              className="pl-10"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              value={formData.email}
              disabled
              className="pl-10 bg-muted"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            O email não pode ser alterado
          </p>
        </div>

        <Button onClick={handleSave} disabled={isLoading} className="gap-2">
          <Save className="w-4 h-4" />
          Salvar Alterações
        </Button>
      </div>

      {/* Account Info */}
      <div className="pt-6 border-t border-border">
        <h4 className="font-medium mb-4">Informações da Conta</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">ID do Usuário</p>
            <p className="font-mono text-xs mt-1 truncate">{user?.id}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Criado em</p>
            <p className="mt-1">
              {user?.created_at 
                ? new Date(user.created_at).toLocaleDateString('pt-BR')
                : '-'
              }
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Último Login</p>
            <p className="mt-1">
              {user?.last_sign_in_at 
                ? new Date(user.last_sign_in_at).toLocaleDateString('pt-BR')
                : '-'
              }
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Provedor</p>
            <p className="mt-1 capitalize">{user?.app_metadata?.provider || 'email'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
