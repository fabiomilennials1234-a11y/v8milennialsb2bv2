import { useState, useEffect } from "react";
import { Mic, Eye, EyeOff, Save, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function ElevenLabsSettings() {
  const { organizationId, role } = useOrganization();
  const queryClient = useQueryClient();
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const isAdmin = role === "admin" || role === "owner";

  const { data: orgData, isLoading } = useQuery({
    queryKey: ["org-elevenlabs-key", organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await (supabase
        .from("organizations")
        .select("elevenlabs_api_key")
        .eq("id", organizationId)
        .single() as any);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && isAdmin,
  });

  useEffect(() => {
    if (orgData?.elevenlabs_api_key) {
      setApiKey(orgData.elevenlabs_api_key);
    }
  }, [orgData]);

  const hasKey = !!orgData?.elevenlabs_api_key;

  const handleSave = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      const { error } = await (supabase
        .from("organizations")
        .update({ elevenlabs_api_key: apiKey || null } as any)
        .eq("id", organizationId) as any);

      if (error) throw error;
      toast.success("Chave da API ElevenLabs salva com sucesso");
      queryClient.invalidateQueries({ queryKey: ["org-elevenlabs-key"] });
    } catch (err) {
      toast.error("Erro ao salvar chave da API");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-violet-500/10 rounded-lg">
          <Mic className="h-5 w-5 text-violet-500" />
        </div>
        <div>
          <h3 className="font-semibold">ElevenLabs</h3>
          <p className="text-sm text-muted-foreground">
            Text-to-Speech para respostas do copilot via audio
          </p>
        </div>
        {hasKey && (
          <Badge variant="outline" className="ml-auto text-green-600 border-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Configurado
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="elevenlabs-key">API Key</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="elevenlabs-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_..."
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Obtenha sua API key em elevenlabs.io. Necessaria para habilitar respostas por audio no copilot.
        </p>
      </div>
    </div>
  );
}
