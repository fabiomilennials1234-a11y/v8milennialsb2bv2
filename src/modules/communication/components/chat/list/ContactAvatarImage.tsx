import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ContactAvatarImageProps {
  /** URL assinada da foto; `null` não desenha nada. */
  url: string | null;
  className?: string;
}

/**
 * A foto do contato POR CIMA do avatar de gradiente que já está na tela.
 *
 * Absoluta sobre o círculo: nada se mexe quando ela chega (zero layout shift)
 * e o gradiente com a inicial é o fallback natural — enquanto carrega, se der
 * erro ou se não houver foto. Entra com fade quando termina de decodificar.
 * `referrerPolicy="no-referrer"`: a URL do Storage não precisa saber de qual
 * tela do CRM veio o pedido.
 */
export function ContactAvatarImage({ url, className }: ContactAvatarImageProps) {
  if (!url) return null;
  // `key`: trocar a URL reinicia o ciclo carregando → visível/erro.
  return <FotoDoContato key={url} url={url} className={className} />;
}

function FotoDoContato({ url, className }: { url: string; className?: string }) {
  const [estado, setEstado] = useState<"carregando" | "pronta" | "erro">("carregando");
  if (estado === "erro") return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-state={estado}
      onLoad={() => setEstado("pronta")}
      onError={() => setEstado("erro")}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full select-none rounded-full object-cover",
        "transition-opacity duration-300 ease-out motion-reduce:transition-none",
        estado === "pronta" ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
