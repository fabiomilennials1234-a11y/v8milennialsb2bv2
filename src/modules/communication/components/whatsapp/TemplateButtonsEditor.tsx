/**
 * TemplateButtonsEditor — os botões de um template, montados pelo vendedor.
 *
 * ─── POR QUE OS TRÊS TIPOS, E NESTA ORDEM ───────────────────────────────────
 *
 * `QUICK_REPLY` devolve um evento — é o único que faz o cliente ENTRAR na
 * conversa, e foi ele que trouxe 152 pessoas em dois dias na Goletric.
 * `URL` leva para fora e funciona mesmo fora da janela de 24h, o que o torna a
 * única forma de puxar de volta um lead frio. `PHONE_NUMBER` abre o discador.
 *
 * As regras da Meta — teto de 10, 1 telefone, 2 links, 25 caracteres, variável
 * só no fim da URL, exemplo obrigatório — vivem em `lib/template-buttons.ts`,
 * testadas. Aqui só se coleta e se mostra o que falta, porque a recusa por
 * regra violada chega horas depois e sem dizer qual regra era.
 */
import { Link2, Phone, Plus, Reply, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { BotaoDoEditor, TipoDeBotao } from "@/modules/communication/lib/template-buttons";

const MAX_BOTOES = 10;

const ROTULOS: Record<TipoDeBotao, { nome: string; icone: typeof Reply; ajuda: string }> = {
  QUICK_REPLY: {
    nome: "Resposta rápida",
    icone: Reply,
    ajuda: "O cliente toca e a resposta cai na conversa. É o que traz a pessoa de volta.",
  },
  URL: {
    nome: "Link",
    icone: Link2,
    ajuda: "Abre um endereço. Use {{1}} no fim para a parte que muda a cada envio.",
  },
  PHONE_NUMBER: {
    nome: "Telefone",
    icone: Phone,
    ajuda: "Abre o discador do celular com o número já preenchido.",
  },
};

/** A URL tem parte variável? Então a Meta exige um exemplo dela. */
function pedeExemplo(url: string | undefined): boolean {
  return /\{\{\s*\d+\s*\}\}/.test(url ?? "");
}

export function TemplateButtonsEditor({
  botoes,
  onChange,
  problemas,
}: {
  botoes: BotaoDoEditor[];
  onChange: (botoes: BotaoDoEditor[]) => void;
  problemas: string[];
}) {
  const trocar = (i: number, campos: Partial<BotaoDoEditor>) =>
    onChange(botoes.map((b, j) => (i === j ? { ...b, ...campos } : b)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Botões (opcional)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={botoes.length >= MAX_BOTOES}
          onClick={() => onChange([...botoes, { tipo: "QUICK_REPLY", texto: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar
        </Button>
      </div>

      {botoes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Sem botão, o template só entrega texto e espera que a pessoa digite.
        </p>
      ) : (
        <div className="space-y-2">
          {botoes.map((botao, i) => {
            const Icone = ROTULOS[botao.tipo].icone;
            return (
              <div key={i} className="space-y-1.5 rounded-lg border border-border/60 p-2.5">
                <div className="flex items-center gap-2">
                  <Select
                    value={botao.tipo}
                    onValueChange={(v) => trocar(i, { tipo: v as TipoDeBotao })}
                  >
                    <SelectTrigger className="h-8 w-[150px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROTULOS) as TipoDeBotao[]).map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">
                          {ROTULOS[t].nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="relative flex-1">
                    <Icone className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={botao.texto}
                      onChange={(e) => trocar(i, { texto: e.target.value })}
                      placeholder="Texto do botão"
                      maxLength={25}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(botoes.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {botao.tipo === "URL" && (
                  <div className="flex gap-2">
                    <Input
                      value={botao.url ?? ""}
                      onChange={(e) => trocar(i, { url: e.target.value })}
                      placeholder="https://sualoja.com.br/pedido/{{1}}"
                      className="h-8 flex-1 text-xs"
                    />
                    {pedeExemplo(botao.url) && (
                      <Input
                        value={botao.exemploDaUrl ?? ""}
                        onChange={(e) => trocar(i, { exemploDaUrl: e.target.value })}
                        placeholder="Exemplo: 4471"
                        className="h-8 w-[140px] text-xs"
                      />
                    )}
                  </div>
                )}

                {botao.tipo === "PHONE_NUMBER" && (
                  <Input
                    value={botao.telefone ?? ""}
                    onChange={(e) => trocar(i, { telefone: e.target.value })}
                    placeholder="+55 44 99999-9999"
                    className="h-8 text-xs"
                  />
                )}

                <p className="text-[10px] text-muted-foreground">{ROTULOS[botao.tipo].ajuda}</p>
              </div>
            );
          })}
        </div>
      )}

      {problemas.map((p) => (
        <p key={p} className={cn("text-[11px] text-destructive")}>
          {p}
        </p>
      ))}
    </div>
  );
}
