import { useState, useEffect } from "react";
import { Volume2, Upload, Loader2, Play, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TtsConfig {
  provider: "elevenlabs";
  voice_id: string;
  mode: "always" | "mirror";
  max_chars: number;
  model_id?: string;
  stability?: number;
  similarity_boost?: number;
}

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
}

interface AgentTtsSettingsProps {
  agentId: string;
  ttsConfig: TtsConfig | null;
  onSave: (config: TtsConfig | null) => void;
}

export function AgentTtsSettings({ agentId, ttsConfig, onSave }: AgentTtsSettingsProps) {
  const [enabled, setEnabled] = useState(!!ttsConfig);
  const [mode, setMode] = useState<"always" | "mirror">(ttsConfig?.mode || "mirror");
  const [voiceId, setVoiceId] = useState(ttsConfig?.voice_id || "");
  const [maxChars, setMaxChars] = useState(ttsConfig?.max_chars || 500);
  const [stability, setStability] = useState(ttsConfig?.stability ?? 0.5);
  const [similarityBoost, setSimilarityBoost] = useState(ttsConfig?.similarity_boost ?? 0.75);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [cloneName, setCloneName] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloningVoice, setCloningVoice] = useState(false);

  const loadVoices = async () => {
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke("elevenlabs-proxy", {
        body: { action: "list_voices" },
      });
      if (error) throw error;
      setVoices(data?.voices || []);
    } catch (err) {
      console.error("Failed to load voices:", err);
      toast.error("Erro ao carregar vozes do ElevenLabs");
    } finally {
      setLoadingVoices(false);
    }
  };

  const handleCloneVoice = async () => {
    if (!cloneConsent || !cloneName || cloneFiles.length === 0) return;
    setCloningVoice(true);
    try {
      const filesBase64 = await Promise.all(
        cloneFiles.map(async (file) => {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          return { name: file.name, data: base64, mime_type: file.type };
        })
      );

      const { data, error } = await supabase.functions.invoke("elevenlabs-proxy", {
        body: { action: "clone_voice", name: cloneName, files: filesBase64 },
      });

      if (error) throw error;
      if (data?.voice_id) {
        setVoiceId(data.voice_id);
        toast.success(`Voz "${cloneName}" clonada com sucesso`);
        setCloneFiles([]);
        setCloneName("");
        setCloneConsent(false);
        await loadVoices();
      }
    } catch (err) {
      console.error("Voice cloning failed:", err);
      toast.error("Erro ao clonar voz");
    } finally {
      setCloningVoice(false);
    }
  };

  useEffect(() => {
    if (enabled && voices.length === 0) {
      loadVoices();
    }
  }, [enabled]);

  const handleToggle = (value: boolean) => {
    setEnabled(value);
    if (!value) {
      onSave(null);
    }
  };

  const handleSave = () => {
    if (!enabled) {
      onSave(null);
      return;
    }
    if (!voiceId) {
      toast.error("Selecione uma voz antes de salvar");
      return;
    }
    onSave({
      provider: "elevenlabs",
      voice_id: voiceId,
      mode,
      max_chars: maxChars,
      stability,
      similarity_boost: similarityBoost,
    });
  };

  const selectedVoice = voices.find(v => v.voice_id === voiceId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-violet-500" />
          <Label className="font-medium">Resposta por Audio (TTS)</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-4 pl-6 border-l-2 border-violet-500/20">
          {/* Mode */}
          <div className="space-y-2">
            <Label>Modo</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "always" | "mirror")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Sempre responder com audio</SelectItem>
                <SelectItem value="mirror">Espelhar — audio so quando lead mandar audio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice selection */}
          <div className="space-y-2">
            <Label>Voz</Label>
            {loadingVoices ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando vozes...
              </div>
            ) : (
              <Select value={voiceId} onValueChange={setVoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma voz" />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                      {voice.name} {voice.category === "cloned" ? "(clonada)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedVoice?.preview_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => new Audio(selectedVoice.preview_url).play()}
              >
                <Play className="h-3 w-3 mr-1" /> Ouvir preview
              </Button>
            )}

            {/* Voice cloning section */}
            <div className="border-t pt-3 mt-3">
              <p className="text-sm font-medium mb-2">Ou clonar uma voz</p>
              <Input
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  setCloneFiles(files);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Envie 1-5 amostras de audio (minimo ~1 minuto total)
              </p>
              {cloneFiles.length > 0 && (
                <>
                  <Input
                    className="mt-2"
                    placeholder="Nome da voz clonada"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <Checkbox
                      id="clone-consent"
                      checked={cloneConsent}
                      onCheckedChange={(v) => setCloneConsent(!!v)}
                    />
                    <Label htmlFor="clone-consent" className="text-xs">
                      Confirmo que tenho permissao para clonar esta voz
                    </Label>
                  </div>
                  <Button
                    className="mt-2 w-full"
                    variant="outline"
                    disabled={!cloneConsent || !cloneName || cloningVoice}
                    onClick={handleCloneVoice}
                  >
                    {cloningVoice ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                    Clonar voz
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Max chars slider */}
          <div className="space-y-2">
            <Label>Limite de caracteres: {maxChars}</Label>
            <Slider
              value={[maxChars]}
              onValueChange={([v]) => setMaxChars(v)}
              min={200}
              max={1000}
              step={50}
            />
            <p className="text-xs text-muted-foreground">
              Respostas maiores serao truncadas para caber neste limite
            </p>
          </div>

          {/* Advanced settings */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                Configuracoes avancadas
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Estabilidade: {stability.toFixed(2)}</Label>
                <Slider
                  value={[stability]}
                  onValueChange={([v]) => setStability(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
              <div className="space-y-2">
                <Label>Similaridade: {similarityBoost.toFixed(2)}</Label>
                <Slider
                  value={[similarityBoost]}
                  onValueChange={([v]) => setSimilarityBoost(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button onClick={handleSave} className="w-full">
            Salvar configuracao de audio
          </Button>
        </div>
      )}
    </div>
  );
}
