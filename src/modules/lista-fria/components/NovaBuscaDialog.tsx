/**
 * Nova busca da Lista Fria: escolher a fonte, preencher o alvo e o teto em
 * créditos (mockups 1–3 do board Miro). Valida na tela o que dá para validar e
 * chama UMA RPC; a recusa do banco aparece com a frase que ele escreveu.
 */
import { ArrowLeft, Loader2, MapPin, Search, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { useCriarBusca, type AlvoDaBusca } from "../hooks/useListaFriaMutacoes";
import { extrairHandleDoInstagram } from "../lib/instagram";
import { recusaDaListaFria } from "../lib/erros";
import { INSTAGRAM_DISPONIVEL } from "../lib/tipos";

type Passo = "fonte" | "instagram" | "maps";

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
  saldo,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Créditos disponíveis. `undefined` enquanto carrega. */
  saldo: number | undefined;
}) {
  const criar = useCriarBusca();
  const [passo, setPasso] = useState<Passo>("fonte");
  const [url, setUrl] = useState("");
  const [nicho, setNicho] = useState("");
  const [cidade, setCidade] = useState("");
  const [creditos, setCreditos] = useState(CREDITOS_SUGERIDOS);

  useEffect(() => {
    if (!aberto) return;
    setPasso("fonte");
    setUrl("");
    setNicho("");
    setCidade("");
    setCreditos(Math.max(1, Math.min(CREDITOS_SUGERIDOS, saldo ?? CREDITOS_SUGERIDOS)));
    // Só reinicia ao abrir: o saldo muda com a busca em andamento e não pode apagar o que o usuário digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const handle = useMemo(() => (url.trim() ? extrairHandleDoInstagram(url) : null), [url]);
  const disponivel = saldo ?? 0;
  const creditosOk = Number.isInteger(creditos) && creditos >= 1 && creditos <= disponivel;
  const alvoOk =
    passo === "instagram" ? handle !== null : passo === "maps" ? nicho.trim().length >= 2 && cidade.trim().length >= 2 : false;

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (!alvoOk || !creditosOk) return;
    const alvo: AlvoDaBusca =
      passo === "instagram" ? { fonte: "instagram", url } : { fonte: "maps", nicho, cidade };
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

  const campoDeCreditos = (
    <div className="space-y-2">
      <Label htmlFor="lf-creditos">Créditos para esta busca</Label>
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
            className="pr-16 font-bold tabular-nums"
            aria-invalid={!creditosOk}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">créditos</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {creditosOk ? (
            <>
              A busca para sozinha quando gastar esses créditos. Saldo depois:{" "}
              <b className="text-foreground tabular-nums">{disponivel - creditos}</b>. O que não render volta para o saldo.
            </>
          ) : (
            <>Use de 1 até o seu saldo ({disponivel}).</>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className={cn(passo === "fonte" ? "sm:max-w-3xl" : "sm:max-w-2xl")}>
        {passo === "fonte" ? (
          <>
            <DialogHeader>
              <DialogTitle>Nova busca na Lista fria</DialogTitle>
              <DialogDescription>
                De onde você quer tirar contatos? A IA encontra telefone e e-mail e você só paga pelo que for válido.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <CartaoDeFonte
                icone={<InstagramIcone className="size-6" />}
                titulo="Instagram"
                texto="Seguidores de uma conta. Cole a URL do perfil e buscamos o contato público de cada seguidor."
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
            </div>
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Zap className="size-4" aria-hidden />
              <span>
                <b className="tabular-nums text-primary">{saldo === undefined ? "·" : saldo} créditos</b> disponíveis · 1 crédito
                por contato novo e válido
              </span>
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
                {passo === "instagram" ? <InstagramIcone className="size-5" /> : <MapPin className="size-5" aria-hidden />}
                {passo === "instagram" ? "Seguidores de uma conta do Instagram" : "Negócios no Google Maps"}
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
                    Vamos buscar nos seguidores de <b className="text-foreground">@{handle}</b>. Só contatos públicos do perfil:
                    bio, botão de contato e link da bio.
                  </p>
                ) : null}
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

            {campoDeCreditos}

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
