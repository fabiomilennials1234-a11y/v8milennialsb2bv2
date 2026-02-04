import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, FileEdit, DollarSign } from "lucide-react";
import { Constants } from "@/integrations/supabase/types";
import type { Campanha } from "@/hooks/useCampanhas";
import type { Tag } from "@/hooks/useTags";

const LEAD_ORIGINS = (Constants?.public?.Enums?.lead_origin as string[]) ?? [
  "whatsapp",
  "meta_ads",
  "outro",
  "site",
  "remarketing",
  "google_ads",
  "cal",
];

interface MktCampanhaConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campanha: Campanha | null;
  tags: Tag[];
  onSave: (payload: {
    id: string;
    mkt_investimento_call_cents: number | null;
    mkt_investimento_cadastro_cents: number | null;
    mkt_call_origins: string[] | null;
    mkt_call_tag_ids: string[] | null;
    mkt_cadastro_origins: string[] | null;
    mkt_cadastro_tag_ids: string[] | null;
    mkt_incluir_call: boolean | null;
    mkt_incluir_cadastro: boolean | null;
  }) => void;
}

export function MktCampanhaConfigModal({
  open,
  onOpenChange,
  campanha,
  tags,
  onSave,
}: MktCampanhaConfigModalProps) {
  const [investimentoCallInput, setInvestimentoCallInput] = useState("");
  const [investimentoCadastroInput, setInvestimentoCadastroInput] = useState("");
  const [incluirCall, setIncluirCall] = useState(true);
  const [incluirCadastro, setIncluirCadastro] = useState(true);
  const [callOrigins, setCallOrigins] = useState<string[]>([]);
  const [callTagIds, setCallTagIds] = useState<string[]>([]);
  const [cadastroOrigins, setCadastroOrigins] = useState<string[]>([]);
  const [cadastroTagIds, setCadastroTagIds] = useState<string[]>([]);

  useEffect(() => {
    if (!campanha) return;
    setInvestimentoCallInput(
      campanha.mkt_investimento_call_cents != null
        ? (campanha.mkt_investimento_call_cents / 100).toFixed(2)
        : ""
    );
    setInvestimentoCadastroInput(
      campanha.mkt_investimento_cadastro_cents != null
        ? (campanha.mkt_investimento_cadastro_cents / 100).toFixed(2)
        : ""
    );
    setIncluirCall(campanha.mkt_incluir_call !== false);
    setIncluirCadastro(campanha.mkt_incluir_cadastro !== false);
    setCallOrigins(campanha.mkt_call_origins ?? []);
    setCallTagIds(campanha.mkt_call_tag_ids ?? []);
    setCadastroOrigins(campanha.mkt_cadastro_origins ?? []);
    setCadastroTagIds(campanha.mkt_cadastro_tag_ids ?? []);
  }, [campanha, open]);

  const handleSave = () => {
    if (!campanha) return;
    if (!incluirCall && !incluirCadastro) return;
    const reaisCall = parseFloat(investimentoCallInput.replace(",", "."));
    const reaisCadastro = parseFloat(investimentoCadastroInput.replace(",", "."));
    const mkt_investimento_call_cents = Number.isNaN(reaisCall)
      ? null
      : Math.round(reaisCall * 100);
    const mkt_investimento_cadastro_cents = Number.isNaN(reaisCadastro)
      ? null
      : Math.round(reaisCadastro * 100);
    onSave({
      id: campanha.id,
      mkt_investimento_call_cents: mkt_investimento_call_cents === 0 ? null : mkt_investimento_call_cents,
      mkt_investimento_cadastro_cents: mkt_investimento_cadastro_cents === 0 ? null : mkt_investimento_cadastro_cents,
      mkt_call_origins: callOrigins.length ? callOrigins : null,
      mkt_call_tag_ids: callTagIds.length ? callTagIds : null,
      mkt_cadastro_origins: cadastroOrigins.length ? cadastroOrigins : null,
      mkt_cadastro_tag_ids: cadastroTagIds.length ? cadastroTagIds : null,
      mkt_incluir_call: incluirCall,
      mkt_incluir_cadastro: incluirCadastro,
    });
    onOpenChange(false);
  };

  const toggleOrigin = (
    origin: string,
    current: string[],
    set: (v: string[]) => void
  ) => {
    if (current.includes(origin)) {
      set(current.filter((o) => o !== origin));
    } else {
      set([...current, origin]);
    }
  };

  const toggleTag = (tagId: string, current: string[], set: (v: string[]) => void) => {
    if (current.includes(tagId)) {
      set(current.filter((id) => id !== tagId));
    } else {
      set([...current, tagId]);
    }
  };

  if (!campanha) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar contagem por tipo — {campanha.name}</DialogTitle>
          <DialogDescription>
            Escolha em qual(is) tipo(s) de marketing esta campanha entra e defina por origem ou etiqueta quais leads contam.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Investimento por tipo (Call e Cadastro) */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <Label className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Investimento por tipo de marketing (R$)
            </Label>
            <p className="text-xs text-muted-foreground">
              Defina o valor específico para cada tipo (Call e/ou Cadastro) desta campanha.
            </p>
            {incluirCall && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Marketing Call</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={investimentoCallInput}
                  onChange={(e) => setInvestimentoCallInput(e.target.value)}
                  className="max-w-[160px]"
                />
              </div>
            )}
            {incluirCadastro && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Marketing Cadastro</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={investimentoCadastroInput}
                  onChange={(e) => setInvestimentoCadastroInput(e.target.value)}
                  className="max-w-[160px]"
                />
              </div>
            )}
          </div>

          {/* Tipo de marketing: Call e/ou Cadastro */}
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <Label className="text-sm font-medium">Tipo de marketing desta campanha</Label>
            <p className="text-xs text-muted-foreground">
              Selecione em qual(is) dashboard(s) esta campanha deve aparecer (pelo menos um).
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={incluirCall}
                  onCheckedChange={(checked) => {
                    if (checked === false && !incluirCadastro) return; // não desmarcar se for o último
                    setIncluirCall(checked === true);
                  }}
                />
                <Calendar className="w-4 h-4 text-primary" />
                <span>Marketing Call</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={incluirCadastro}
                  onCheckedChange={(checked) => {
                    if (checked === false && !incluirCall) return;
                    setIncluirCadastro(checked === true);
                  }}
                />
                <FileEdit className="w-4 h-4 text-primary" />
                <span>Marketing Cadastro</span>
              </label>
            </div>
          </div>

          {/* Marketing Call — só se incluir Call */}
          {incluirCall && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Calendar className="w-4 h-4 text-primary" />
              Conta para Marketing Call
            </div>
            <div className="space-y-2 pl-6">
              <Label className="text-xs text-muted-foreground">Por origem</Label>
              <div className="flex flex-wrap gap-2">
                {LEAD_ORIGINS.map((origin) => (
                  <label
                    key={origin}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={callOrigins.includes(origin)}
                      onCheckedChange={() =>
                        toggleOrigin(origin, callOrigins, setCallOrigins)
                      }
                    />
                    <span className="capitalize">{origin}</span>
                  </label>
                ))}
              </div>
              <Label className="text-xs text-muted-foreground mt-3 block">Por etiqueta</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={callTagIds.includes(tag.id)}
                      onCheckedChange={() =>
                        toggleTag(tag.id, callTagIds, setCallTagIds)
                      }
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Marketing Cadastro — só se incluir Cadastro */}
          {incluirCadastro && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <FileEdit className="w-4 h-4 text-primary" />
              Conta para Marketing Cadastro
            </div>
            <div className="space-y-2 pl-6">
              <Label className="text-xs text-muted-foreground">Por origem</Label>
              <div className="flex flex-wrap gap-2">
                {LEAD_ORIGINS.map((origin) => (
                  <label
                    key={origin}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={cadastroOrigins.includes(origin)}
                      onCheckedChange={() =>
                        toggleOrigin(origin, cadastroOrigins, setCadastroOrigins)
                      }
                    />
                    <span className="capitalize">{origin}</span>
                  </label>
                ))}
              </div>
              <Label className="text-xs text-muted-foreground mt-3 block">Por etiqueta</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={cadastroTagIds.includes(tag.id)}
                      onCheckedChange={() =>
                        toggleTag(tag.id, cadastroTagIds, setCadastroTagIds)
                      }
                    />
                    <span>{tag.name}</span>
                  </label>
                ))}
                {tags.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
                )}
              </div>
            </div>
          </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={!incluirCall && !incluirCadastro}
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
