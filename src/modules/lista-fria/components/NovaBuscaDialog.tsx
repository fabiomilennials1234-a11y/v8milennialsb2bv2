/**
 * Nova busca da Lista Fria: escolher a fonte, preencher o alvo e o teto em
 * créditos (mockups 1–3 do board Miro). Valida na tela o que dá para validar e
 * chama UMA RPC; a recusa do banco aparece com a frase que ele escreveu.
 */
import { ArrowLeft, Building2, Loader2, MapPin, Search, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { useCriarBusca, type AlvoDaBusca } from "../hooks/useListaFriaMutacoes";
import { extrairHandleDoInstagram } from "../lib/instagram";
import { recusaDaListaFria } from "../lib/erros";
import { formatarReais, PRECO_DO_CREDITO_CENTAVOS } from "../lib/pacotes";
import { CONTATOS_EXIGIDOS, INSTAGRAM_CREDITOS_MAX, INSTAGRAM_CREDITOS_MIN, INSTAGRAM_CREDITOS_SUGERIDO, INSTAGRAM_DISPONIVEL, ROTULO_CONTATO, ROTULO_CREDITO, type ContatoExigido, type Saldos, type TipoDeCredito } from "../lib/tipos";
import { BotaoComprarCreditos } from "./BotaoComprarCreditos";
import { SeletorDeCnae } from "./SeletorDeCnae";

type Passo = "fonte" | "instagram" | "maps" | "cnpj";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

const CREDITOS_SUGERIDOS = 500;


function InstagramIcone({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}

function CartaoDeFonte({
  icone,
  titulo,
  texto,
  exemplo,
  emBreve = false,
  onEscolher,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  exemplo: string;
  emBreve?: boolean;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEscolher}
      disabled={emBreve}
      className={cn(
        "group flex flex-col items-start rounded-[22px] border border-card-border bg-sunken p-5 text-left shadow-relevo",
        "transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-primary/40",
        "disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">{icone}</span>
      <span className="mt-4 text-[17px] font-extrabold tracking-tight">{titulo}</span>
      <span className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{texto}</span>
      <span className="mt-4 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">{emBreve ? "Em breve" : exemplo}</span>
    </button>
  );
}

export function NovaBuscaDialog({
  aberto,
  onFechar,
  saldos,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Os dois saldos (normal e Meta). `undefined` enquanto carrega. */
  saldos: Saldos | undefined;
}) {
  const criar = useCriarBusca();
  const [passo, setPasso] = useState<Passo>("fonte");
  const [url, setUrl] = useState("");
  const [nicho, setNicho] = useState("");
  const [cidade, setCidade] = useState("");
  const [creditos, setCreditos] = useState(CREDITOS_SUGERIDOS);
  const [cnaes, setCnaes] = useState<string[]>([]);
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [contato, setContato] = useState<ContatoExigido>("qualquer");

  useEffect(() => {
    if (!aberto) return;
    setPasso("fonte");
    setUrl("");
    setNicho("");
    setCidade("");
    setCnaes([]);
    setUf("");
    setMunicipio("");
    setContato("qualquer");
    setCreditos(Math.max(1, Math.min(CREDITOS_SUGERIDOS, saldos?.normal ?? CREDITOS_SUGERIDOS)));
    // Só reinicia ao abrir: o saldo muda com a busca em andamento e não pode apagar o que o usuário digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const handle = useMemo(() => (url.trim() ? extrairHandleDoInstagram(url) : null), [url]);
  // Instagram gasta do saldo Meta; Maps e CNPJ, do normal. O banco decide; aqui só se mostra o saldo certo.
  const tipo: TipoDeCredito = passo === "instagram" ? "meta" : "normal";
  const disponivel = saldos?.[tipo] ?? 0;

  useEffect(() => {
    if (passo === "fonte") return;
    if (passo === "instagram") {
      setCreditos(Math.max(INSTAGRAM_CREDITOS_MIN, Math.min(INSTAGRAM_CREDITOS_SUGERIDO, saldos?.meta ?? INSTAGRAM_CREDITOS_SUGERIDO)));
      return;
    }
    setCreditos(Math.max(1, Math.min(CREDITOS_SUGERIDOS, saldos?.normal ?? CREDITOS_SUGERIDOS)));
    // Só ao trocar de fonte: o saldo muda com a busca em andamento e não pode apagar o que o usuário digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passo]);
  const creditosOk =
    passo === "instagram"
      ? Number.isInteger(creditos) && creditos >= INSTAGRAM_CREDITOS_MIN && creditos <= Math.min(INSTAGRAM_CREDITOS_MAX, disponivel)
      : Number.isInteger(creditos) && creditos >= 1 && creditos <= disponivel;
  const municipioOk = municipio.trim() === "" || (municipio.trim().length >= 2 && municipio.trim().length <= 80);
  const alvoOk =
    passo === "instagram"
      ? handle !== null
      : passo === "maps"
        ? nicho.trim().length >= 2 && cidade.trim().length >= 2
        : passo === "cnpj"
          ? cnaes.length >= 1 && uf !== "" && municipioOk
          : false;

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!alvoOk || !creditosOk) return;
    const alvo: AlvoDaBusca =
      passo === "instagram"
        ? { fonte: "instagram", url }
        : passo === "cnpj"
          ? { fonte: "cnpj", cnaes, uf, municipio, contato }
          : { fonte: "maps", nicho, cidade };
    criar.mutate(
      { alvo, creditos },
      {
        onSuccess: () => {
          toast.success("Busca iniciada. Pode sair desta tela: o resultado aparece em Buscas quando terminar.");
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível iniciar a busca.",
            message: recusaDaListaFria(err as { code?: string; message?: string }),
            context: { feature: "lista-fria" },
          }),
      },
    );
  };

  // Instagram: o cliente escolhe quantos seguidores analisar (1 crédito Meta cada). Ele paga pelos seguidores
  // analisados, não pelos contatos achados, e precisa saber disso ANTES de iniciar (o rendimento depende da conta
  // e ninguém sabe de antemão).
  const maximoInstagram = Math.min(INSTAGRAM_CREDITOS_MAX, disponivel);
  const precoDaBuscaInstagram = formatarReais((Number.isFinite(creditos) ? creditos : 0) * PRECO_DO_CREDITO_CENTAVOS.meta);
  const blocoDoInstagram = (
    <div className="space-y-3" data-testid="preco-instagram">
      <div className="space-y-2">
        <Label htmlFor="lf-creditos">Seguidores a analisar</Label>
        <div className="grid items-center gap-3 sm:grid-cols-[9.5rem_1fr]">
          <div className="relative">
            <Input
              id="lf-creditos"
              type="number"
              inputMode="numeric"
              min={INSTAGRAM_CREDITOS_MIN}
              max={maximoInstagram || undefined}
              value={Number.isFinite(creditos) ? creditos : ""}
              onChange={(e) => setCreditos(e.target.value === "" ? Number.NaN : Number(e.target.value))}
              className="pr-28 font-bold tabular-nums"
              aria-invalid={!creditosOk}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{ROTULO_CREDITO.meta}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {creditosOk ? (
              <>
                Esta busca custa <b className="text-foreground tabular-nums">{creditos} créditos Meta</b> ({precoDaBuscaInstagram}). Saldo depois:{" "}
                <b className="text-foreground tabular-nums">{disponivel - creditos}</b>.
              </>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Use de {INSTAGRAM_CREDITOS_MIN} a {INSTAGRAM_CREDITOS_MAX.toLocaleString("pt-BR")}, até o seu saldo ({disponivel}). Precisa de mais?{" "}
                <BotaoComprarCreditos />
              </span>
            )}
          </p>
        </div>
      </div>
      <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Cada seguidor analisado gasta 1 crédito, venha contato ou não: o preço é o mesmo seja qual for o resultado. Contas com
        pouco contato público rendem pouco, e a conta pode ter menos seguidores do que você pediu (o que não for analisado volta
        para o saldo). Se a busca terminar sem nenhum contato, metade dos créditos gastos volta para o saldo.
      </p>
    </div>
  );

  const campoDeCreditos = (
    <div className="space-y-2">
      <Label htmlFor="lf-creditos">{tipo === "meta" ? "Créditos Meta para esta busca" : "Créditos para esta busca"}</Label>
      <div className="grid items-center gap-3 sm:grid-cols-[9.5rem_1fr]">
        <div className="relative">
          <Input
            id="lf-creditos"
            type="number"
            inputMode="numeric"
            min={1}
            max={disponivel || undefined}
            value={Number.isFinite(creditos) ? creditos : ""}
            onChange={(e) => setCreditos(e.target.value === "" ? Number.NaN : Number(e.target.value))}
            className="pr-28 font-bold tabular-nums"
            aria-invalid={!creditosOk}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{ROTULO_CREDITO[tipo]}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {creditosOk ? (
            <>
              A busca para sozinha quando gastar esses créditos. Saldo depois:{" "}
              <b className="text-foreground tabular-nums">{disponivel - creditos}</b>. O que não render volta para o saldo.
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              Use de 1 até o seu saldo ({disponivel}). Precisa de mais? <BotaoComprarCreditos />
            </span>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className={cn(passo === "fonte" ? "sm:max-w-4xl" : "sm:max-w-2xl")}>
        {passo === "fonte" ? (
          <>
            <DialogHeader>
              <DialogTitle>Nova busca na Lista fria</DialogTitle>
              <DialogDescription>
                De onde você quer tirar contatos? A IA encontra telefone e e-mail e você só paga pelo que for válido.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3.5 sm:grid-cols-3">
              <CartaoDeFonte
                icone={<InstagramIcone className="size-6" />}
                titulo="Instagram"
                texto="Os primeiros seguidores de uma conta (cerca de 50, o limite do acesso público). Cole a URL do perfil e buscamos o contato público de cada um. Usa créditos Meta."
                exemplo="Ex.: instagram.com/clinicaodontovida"
                emBreve={!INSTAGRAM_DISPONIVEL}
                onEscolher={() => setPasso("instagram")}
              />
              <CartaoDeFonte
                icone={<MapPin className="size-6" />}
                titulo="Google Maps"
                texto="Negócios de um nicho em uma cidade. Buscamos telefone no Maps e e-mail no site de cada um."
                exemplo="Ex.: Dentistas · São Paulo - SP"
                onEscolher={() => setPasso("maps")}
              />
              <CartaoDeFonte
                icone={<Building2 className="size-6" />}
                titulo="Empresas por CNAE"
                texto="Empresas ativas de uma atividade em um estado ou cidade, da base aberta da Receita. Volume alto, com e-mail e telefone cadastrados."
                exemplo="Ex.: Atacadistas · SP"
                onEscolher={() => setPasso("cnpj")}
              />
            </div>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Zap className="size-4" aria-hidden />
              <span>
                <b className="tabular-nums text-primary">{saldos === undefined ? "·" : saldos.normal} créditos</b> e{" "}
                <b className="tabular-nums text-primary">{saldos === undefined ? "·" : saldos.meta} créditos Meta</b> disponíveis · Google Maps e CNPJ: 1
                crédito por contato novo e válido · Instagram: 1 crédito Meta por seguidor analisado
              </span>
              <BotaoComprarCreditos />
            </p>
          </>
        ) : (
          <form onSubmit={enviar} className="space-y-5" noValidate>
            <DialogHeader>
              <button
                type="button"
                onClick={() => setPasso("fonte")}
                className="mb-1 inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden /> Nova busca
              </button>
              <DialogTitle className="flex items-center gap-2.5">
                {passo === "instagram" ? (
                  <InstagramIcone className="size-5" />
                ) : passo === "cnpj" ? (
                  <Building2 className="size-5" aria-hidden />
                ) : (
                  <MapPin className="size-5" aria-hidden />
                )}
                {passo === "instagram" ? "Seguidores de uma conta do Instagram" : passo === "cnpj" ? "Empresas por atividade (CNAE)" : "Negócios no Google Maps"}
              </DialogTitle>
              <DialogDescription className="sr-only">Preencha o alvo da busca e o limite de créditos.</DialogDescription>
            </DialogHeader>

            {passo === "instagram" ? (
              <div className="space-y-2">
                <Label htmlFor="lf-url">URL da conta</Label>
                <Input
                  id="lf-url"
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.instagram.com/clinicaodontovida/"
                  aria-invalid={url.trim() !== "" && handle === null}
                />
                {url.trim() !== "" && handle === null ? (
                  <p className="text-xs text-destructive-strong">Cole a URL de uma conta, não de um post.</p>
                ) : handle ? (
                  <p className="text-xs text-muted-foreground">
                    Vamos analisar os primeiros ~50 seguidores de <b className="text-foreground">@{handle}</b>, o limite do acesso
                    público. Só contatos públicos do perfil (bio, botão de contato e link da bio). Costuma render até uns 10
                    contatos.
                  </p>
                ) : null}
              </div>
            ) : passo === "cnpj" ? (
              <div className="space-y-5">
                <SeletorDeCnae valor={cnaes} onChange={setCnaes} />
                <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
                  <div className="space-y-2">
                    <Label htmlFor="lf-uf">Estado</Label>
                    <Select value={uf} onValueChange={setUf}>
                      <SelectTrigger id="lf-uf" aria-label="Estado">
                        <SelectValue placeholder="UF" />
                      </SelectTrigger>
                      <SelectContent>
                        {UFS.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lf-municipio">Cidade (opcional)</Label>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input
                        id="lf-municipio"
                        value={municipio}
                        onChange={(e) => setMunicipio(e.target.value)}
                        placeholder="Todas as cidades do estado"
                        className="pl-9"
                        maxLength={80}
                        aria-invalid={!municipioOk}
                      />
                    </div>
                  </div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium leading-none">Contato</legend>
                  <div className="flex flex-wrap gap-2">
                    {CONTATOS_EXIGIDOS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={contato === c}
                        onClick={() => setContato(c)}
                        className={cn(
                          "h-9 rounded-full border px-4 text-[13px] font-semibold transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          contato === c
                            ? "border-primary bg-primary-soft text-primary-soft-foreground"
                            : "border-card-border bg-sunken text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {ROTULO_CONTATO[c]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Só matrizes de empresas ativas, sem empresário individual. E-mail de contador (repetido em muitas empresas) é descartado.
                  </p>
                </fieldset>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lf-nicho">Nicho</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input id="lf-nicho" autoFocus value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Dentistas" className="pl-9" maxLength={80} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lf-cidade">Cidade</Label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input id="lf-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="São Paulo - SP" className="pl-9" maxLength={80} />
                  </div>
                </div>
              </div>
            )}

            {passo === "instagram" ? blocoDoInstagram : campoDeCreditos}

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button type="button" variant="ghost" onClick={onFechar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!alvoOk || !creditosOk || criar.isPending}>
                {criar.isPending ? <Loader2 className="animate-spin" /> : <Search />}
                Iniciar busca
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
