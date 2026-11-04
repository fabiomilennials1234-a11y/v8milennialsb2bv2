/**
 * Compra de créditos (ADR-0045): seis pacotes (Google, Google +, Google Max e os três da Meta), um "Outro" e,
 * escolhido o pacote, o PIX com QR Code e "copia e cola".
 *
 * Não há cobrança automática: o QR leva o cliente ao PIX, e o "Já paguei" abre um Chamado com o pacote, o valor
 * e a referência, para o time conferir o dinheiro e liberar o saldo. "Outro" abre um Chamado com o pedido pronto.
 * O Chamado entra por `onAbrirChamado`; `null` = suporte indisponível para este perfil (o botão fica desligado).
 */
import { ArrowLeft, Check, Copy, MessageSquareText, Star } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SupportPrefill } from "@/shared/errors";

import {
  CHAMADO_OUTRO,
  NOME_COMERCIAL,
  PACOTES_GOOGLE,
  PACOTES_META,
  PRECO_DO_CREDITO_CENTAVOS,
  centavosPorCredito,
  chamadoDePagamento,
  chamadoDePedido,
  formatarReais,
  formatarReaisPorCredito,
  precoDoPacote,
  type Pacote,
} from "../lib/pacotes";
import { novaReferencia, payloadPix, type RecebedorPix } from "../lib/pix";

function CartaoDePacote({ pacote, onEscolher }: { pacote: Pacote; onEscolher: () => void }) {
  const preco = precoDoPacote(pacote);
  const creditos = pacote.creditos.toLocaleString("pt-BR");
  return (
    <button
      type="button"
      onClick={onEscolher}
      aria-label={`${pacote.nome}: ${creditos} créditos por ${formatarReais(preco)}`}
      className={cn(
        "relative flex flex-col items-start rounded-[22px] border bg-sunken p-4 text-left shadow-relevo",
        "transition-[transform,border-color] duration-150 hover:-translate-y-px hover:border-primary/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pacote.maisComprado ? "border-primary/50" : "border-card-border",
      )}
    >
      {pacote.maisComprado && (
        <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
          <Star className="size-3" aria-hidden /> Mais comprado
        </span>
      )}
      <span className="text-[15px] font-extrabold tracking-tight">{pacote.nome}</span>
      <span className="mt-2 text-2xl font-extrabold tabular-nums">
        {creditos} <span className="text-sm font-semibold text-muted-foreground">créditos</span>
      </span>
      <span className="mt-1 text-lg font-bold tabular-nums text-primary">{formatarReais(preco)}</span>
      <span className="mt-1 text-xs text-muted-foreground">
        {formatarReaisPorCredito(centavosPorCredito(pacote))} por crédito
        {pacote.descontoPct > 0 && (
          <b className="ml-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] text-success-strong">{pacote.descontoPct}% off</b>
        )}
      </span>
    </button>
  );
}

function Familia({ titulo, detalhe, pacotes, onEscolher }: { titulo: string; detalhe: string; pacotes: readonly Pacote[]; onEscolher: (p: Pacote) => void }) {
  return (
    <section aria-label={titulo} className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-extrabold tracking-tight">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{detalhe}</p>
      </div>
      <div className="grid gap-3.5 pt-1.5 sm:grid-cols-3">
        {pacotes.map((p) => (
          <CartaoDePacote key={p.id} pacote={p} onEscolher={() => onEscolher(p)} />
        ))}
      </div>
    </section>
  );
}

export function ComprarCreditosDialog({
  aberto,
  onFechar,
  recebedor,
  onAbrirChamado,
  gerarReferencia = novaReferencia,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Conta que recebe o PIX. `null` = não configurada: a tela avisa em vez de mostrar um QR sem destino. */
  recebedor: RecebedorPix | null;
  /** Abre o Chamado com o texto pronto. `null` = suporte indisponível para este perfil. */
  onAbrirChamado: ((prefill: SupportPrefill) => void) | null;
  /** Injetável para o teste: a referência muda a cada pacote escolhido. */
  gerarReferencia?: () => string;
}) {
  const [pacote, setPacote] = useState<Pacote | null>(null);
  const [referencia, setReferencia] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (aberto) return;
    setPacote(null);
    setCopiado(false);
  }, [aberto]);

  const escolher = (p: Pacote) => {
    setReferencia(gerarReferencia());
    setCopiado(false);
    setPacote(p);
  };

  const codigo = useMemo(() => {
    if (!pacote || !recebedor || !referencia) return null;
    try {
      return payloadPix({ recebedor, valorCentavos: precoDoPacote(pacote), referencia });
    } catch {
      return null;
    }
  }, [pacote, recebedor, referencia]);

  const abrirChamado = (prefill: SupportPrefill) => {
    if (!onAbrirChamado) return;
    onAbrirChamado(prefill);
    onFechar();
  };

  const copiar = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      toast.success("Código PIX copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie à mão.");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {!pacote ? (
          <>
            <DialogHeader>
              <DialogTitle>Comprar créditos</DialogTitle>
              <DialogDescription>
                Escolha um pacote e pague por PIX. Depois de pagar, o time libera o saldo. O crédito só é gasto por contato novo e válido.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <Familia
                titulo="Créditos Google"
                detalhe={`Maps e CNPJ · ${formatarReais(PRECO_DO_CREDITO_CENTAVOS.normal)} cada, sem desconto`}
                pacotes={PACOTES_GOOGLE}
                onEscolher={escolher}
              />
              <Familia
                titulo="Créditos Meta"
                detalhe={`Instagram · ${formatarReais(PRECO_DO_CREDITO_CENTAVOS.meta)} cada, sem desconto`}
                pacotes={PACOTES_META}
                onEscolher={escolher}
              />
              <button
                type="button"
                disabled={!onAbrirChamado}
                onClick={() => abrirChamado(CHAMADO_OUTRO)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[22px] border border-dashed border-card-border bg-sunken p-4 text-left",
                  "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-60",
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                  <MessageSquareText className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[15px] font-extrabold tracking-tight">Outro</span>
                  <span className="block text-xs text-muted-foreground">
                    {onAbrirChamado
                      ? "Outra quantidade ou outra forma de pagamento. Abre um chamado com o pedido pronto."
                      : "Indisponível para o seu perfil."}
                  </span>
                </span>
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <button
                type="button"
                onClick={() => setPacote(null)}
                className="mb-1 inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden /> Pacotes
              </button>
              <DialogTitle>
                {pacote.nome} · {pacote.creditos.toLocaleString("pt-BR")} créditos {NOME_COMERCIAL[pacote.tipo]}
              </DialogTitle>
              <DialogDescription>
                Pague <b className="text-foreground">{formatarReais(precoDoPacote(pacote))}</b> por PIX. Depois clique em "Já paguei" e anexe o
                comprovante: abrimos um chamado com tudo pronto.
              </DialogDescription>
            </DialogHeader>

            {codigo && recebedor ? (
              <div className="grid gap-6 sm:grid-cols-[15rem_1fr]">
                <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-relevo">
                  <QRCodeSVG value={codigo} size={208} level="M" bgColor="#ffffff" fgColor="#000000" aria-label="QR Code do PIX" />
                </div>
                <div className="min-w-0 space-y-4">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                    <dt className="text-muted-foreground">Valor</dt>
                    <dd className="font-bold tabular-nums">{formatarReais(precoDoPacote(pacote))}</dd>
                    <dt className="text-muted-foreground">Recebedor</dt>
                    <dd className="font-semibold">{recebedor.nome}</dd>
                    <dt className="text-muted-foreground">Chave PIX</dt>
                    <dd className="break-all font-semibold">{recebedor.chave}</dd>
                    <dt className="text-muted-foreground">Referência</dt>
                    <dd className="font-semibold tabular-nums">{referencia}</dd>
                  </dl>
                  <div className="space-y-1.5">
                    <label htmlFor="lf-pix-copia" className="text-xs font-medium text-muted-foreground">
                      Pix copia e cola
                    </label>
                    <textarea
                      id="lf-pix-copia"
                      readOnly
                      value={codigo}
                      rows={4}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full resize-none rounded-xl border border-card-border bg-sunken p-3 text-xs leading-relaxed"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={copiar}>
                      {copiado ? <Check /> : <Copy />}
                      {copiado ? "Copiado" : "Copiar código"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-card-border bg-sunken p-4 text-[13px] leading-relaxed text-muted-foreground" role="status">
                O pagamento por PIX ainda não está configurado. Use <b className="text-foreground">Falar com o time</b> para pedir este pacote por
                chamado.
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button type="button" variant="ghost" onClick={onFechar}>
                Fechar
              </Button>
              <Button type="button" disabled={!onAbrirChamado} onClick={() => abrirChamado(codigo ? chamadoDePagamento(pacote, referencia) : chamadoDePedido(pacote))}>
                <MessageSquareText />
                {codigo ? "Já paguei" : "Falar com o time"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
