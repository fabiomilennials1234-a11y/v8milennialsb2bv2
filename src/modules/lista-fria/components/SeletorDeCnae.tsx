/**
 * Escolha de CNAEs da busca por CNPJ (ADR-0043): digita um código ("4639", "46.39-7/01") ou uma
 * palavra ("dentista") e escolhe. Um código de 2 a 6 dígitos oferece "todo o grupo". A lista oficial
 * (1.359 atividades) só é baixada quando este seletor monta.
 */
import { Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  MAX_CNAES,
  adicionarPrefixo,
  buscarCnaes,
  contarDoPrefixo,
  descricaoDoPrefixo,
  digitosDoCodigo,
  formatarCnae,
  removerPrefixo,
  type Cnae,
} from "../lib/cnae";

export function SeletorDeCnae({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const [lista, setLista] = useState<readonly Cnae[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [termo, setTermo] = useState("");

  useEffect(() => {
    let vivo = true;
    import("../data/cnaes.json")
      .then((m) => vivo && setLista(m.default as unknown as readonly Cnae[]))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, []);

  const achados = useMemo(() => (lista ? buscarCnaes(lista, termo) : []), [lista, termo]);
  const codigo = digitosDoCodigo(termo);
  const grupo = codigo && codigo.length < 7 && lista && contarDoPrefixo(lista, codigo) > 1 ? { prefixo: codigo, n: contarDoPrefixo(lista, codigo) } : null;
  const cheio = valor.length >= MAX_CNAES;

  const adicionar = (prefixo: string) => onChange(adicionarPrefixo(valor, prefixo));

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="lf-cnae">Atividade (CNAE)</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {valor.length}/{MAX_CNAES}
        </span>
      </div>

      {valor.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="CNAEs escolhidos">
          {valor.map((p) => (
            <li key={p} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-3 pr-1.5 text-xs text-primary-soft-foreground">
              <b className="tabular-nums">{formatarCnae(p)}</b>
              <span className="max-w-[16rem] truncate opacity-80">{lista ? descricaoDoPrefixo(lista, p) : ""}</span>
              <button
                type="button"
                onClick={() => onChange(removerPrefixo(valor, p))}
                aria-label={`Remover CNAE ${formatarCnae(p)}`}
                className="grid size-5 place-items-center rounded-full hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="lf-cnae"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Código ou palavra: 4639, atacadista, dentista…"
          className="pl-9"
          autoComplete="off"
          disabled={falhou}
        />
      </div>

      {falhou ? (
        <p className="text-xs text-destructive-strong">Não foi possível carregar a lista de CNAEs. Recarregue a página.</p>
      ) : !lista ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Carregando a lista de atividades…
        </p>
      ) : termo.trim().length >= 2 ? (
        <div className="max-h-52 overflow-y-auto rounded-2xl border border-card-border bg-sunken p-1" aria-live="polite">
          {grupo && (
            <button
              type="button"
              onClick={() => adicionar(grupo.prefixo)}
              disabled={cheio}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-primary",
                "hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              )}
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              Todas as {grupo.n} atividades de {formatarCnae(grupo.prefixo)}
            </button>
          )}
          {achados.length === 0 && !grupo ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma atividade com “{termo.trim()}”.</p>
          ) : (
            achados.map(([cod, descricao]) => {
              const ja = valor.some((v) => cod.startsWith(v));
              return (
                <button
                  key={cod}
                  type="button"
                  onClick={() => adicionar(cod)}
                  disabled={ja || cheio}
                  className={cn(
                    "flex w-full items-baseline gap-2.5 rounded-xl px-3 py-2 text-left text-[13px]",
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:hover:bg-transparent",
                  )}
                >
                  <b className="shrink-0 tabular-nums">{formatarCnae(cod)}</b>
                  <span className="text-muted-foreground">{descricao}</span>
                  {ja && <span className="ml-auto shrink-0 text-[11px] font-semibold text-success-strong">Escolhido</span>}
                </button>
              );
            })
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Escolha uma ou mais atividades. Pode misturar (ex.: 8630 e 8650).</p>
      )}
      {cheio && <p className="text-xs text-muted-foreground">Limite de {MAX_CNAES} atividades por busca.</p>}
    </div>
  );
}
