/**
 * Bloco de identidade no pé da lateral.
 *
 * Recolhe o que a top bar carregava solto e que não é rota — por isso não cabe
 * nem na navegação nem no Pitstop: foto de perfil, tema e sair. Para master,
 * carrega também a troca de contexto (Master Admin e Painel do Gestor).
 */

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ChevronsUpDown, LineChart, Loader2, LogOut, Moon, Shield, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import { useAuth, useIdentity, useJobTitle, useMasterAuth, useUserRole } from "@/modules/identity";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function SidebarUserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { data: userRole } = useUserRole();
  const { jobTitle } = useJobTitle();
  const { isMaster } = useIdentity();
  const { isOutbounder } = useMasterAuth();
  const { resolvedTheme } = useTheme();
  const themeTransition = useThemeTransition();

  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDark = resolvedTheme === "dark";
  const name = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuário";
  const roleLabel = jobTitle || (userRole?.role === "admin" ? "Administrador" : "Membro");
  const currentAvatarUrl = avatarUrl || user?.user_metadata?.avatar_url || null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("A imagem precisa ter no máximo 5MB.");
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `avatars/${user.id}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

      setAvatarUrl(publicUrl);
      queryClient.invalidateQueries({ queryKey: ["avatar-map"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Foto de perfil atualizada.");
      setAvatarModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível enviar a foto.";
      toast.error(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const trigger = (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border px-2 py-1.5 text-left transition-colors",
        "hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed && "justify-center px-0",
      )}
    >
      <UserAvatar
        name={name}
        avatarUrl={currentAvatarUrl}
        size="sm"
        fallbackClassName="bg-primary/90 text-primary-foreground text-xs font-semibold"
      />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-sidebar-foreground">{name}</span>
            <span className="block truncate text-[10.5px] text-sidebar-foreground/50">{roleLabel}</span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" />
        </>
      )}
    </button>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <Tooltip delayDuration={120}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {name}
              </TooltipContent>
            </Tooltip>
          ) : (
            trigger
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-56 rounded-xl p-1.5">
          <DropdownMenuLabel className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">{roleLabel}</p>
          </DropdownMenuLabel>

          {isMaster && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate("/master")}
                className="cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-destructive focus:text-destructive"
              >
                <Shield className="h-4 w-4" />
                <span>{isOutbounder ? "Painel Outbound" : "Master Admin"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => navigate("/insights")}
                className="cursor-pointer gap-2.5 rounded-lg px-3 py-2"
              >
                <LineChart className="h-4 w-4 opacity-60" />
                <span>Painel do Gestor</span>
              </DropdownMenuItem>
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setAvatarModalOpen(true)}
            className="cursor-pointer gap-2.5 rounded-lg px-3 py-2"
          >
            <Camera className="h-4 w-4 opacity-60" />
            <span>Foto de perfil</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e: Event) => e.preventDefault()}
            onClick={() => themeTransition?.requestThemeChange(isDark ? "light" : "dark")}
            className="cursor-pointer gap-2.5 rounded-lg px-3 py-2"
          >
            {isDark ? <Sun className="h-4 w-4 opacity-60" /> : <Moon className="h-4 w-4 opacity-60" />}
            <span className="flex-1">{isDark ? "Tema claro" : "Tema escuro"}</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={signOut}
            className="cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4 opacity-60" />
            <span>Sair</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={avatarModalOpen} onOpenChange={setAvatarModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto de perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <UserAvatar
              name={name}
              avatarUrl={currentAvatarUrl}
              size="lg"
              fallbackClassName="bg-primary/90 text-primary-foreground text-lg font-semibold"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full gap-2"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {isUploading ? "Enviando…" : "Escolher imagem"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">JPG ou PNG, até 5MB.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
