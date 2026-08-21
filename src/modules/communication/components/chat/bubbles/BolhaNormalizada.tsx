/**
 * BolhaNormalizada — o que a `MessagePrimitives` não sabia desenhar.
 *
 * ─── O QUE ELA COBRE, E POR QUÊ SÓ ISSO ─────────────────────────────────────
 *
 * Áudio, imagem, vídeo e documento continuam nos ramos de sempre: eles já
 * funcionam, e o que faltava era a URL, que o parser passou a achar. Aqui ficam
 * os quatro casos que o caminho antigo desenha errado ou não desenha:
 *
 *   resposta     — hoje vira texto solto, sem dizer que o cliente TOCOU num botão
 *   link         — reel/post compartilhado, que hoje cai em "[Mensagem não suportada]"
 *   localizacao  — hoje diz "Localização compartilhada" e não abre mapa nenhum
 *   contato      — hoje diz "Contato compartilhado" e esconde o telefone
 *
 * ⚠️ Só é usada quando `metadata` existe na linha, o que nunca acontece no chat
 * da Uazapi: aquele lê `whatsapp_messages`, que não tem a coluna.
 */
import { Contact as ContactIcon, ExternalLink, MapPin, Phone, Reply } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Bolha } from "@/modules/communication/lib/inbound-metadata";

export function BolhaNormalizada({ bolha }: { bolha: Bolha }) {
  if (bolha.tipo === "resposta") {
    return (
      <div className="space-y-1">
        {/* O selo vem ANTES e pequeno: quem lê precisa ver a escolha, e saber
            que ela veio de um toque é contexto — explica por que a resposta é
            exatamente uma das opções que mandamos. */}
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70">
          <Reply className="h-3 w-3 shrink-0" />
          <span>Respondeu</span>
        </div>
        <p className="text-sm font-medium break-words">{bolha.titulo}</p>
      </div>
    );
  }

  if (bolha.tipo === "link") {
    const rotulo = bolha.especie === "reel"
      ? "Reel compartilhado"
      : bolha.especie === "post"
      ? "Publicação compartilhada"
      : "Link compartilhado";

    return (
      <a
        href={bolha.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm underline underline-offset-2 hover:opacity-80"
      >
        <ExternalLink className="h-4 w-4 shrink-0" />
        <span className="break-all">{rotulo}</span>
      </a>
    );
  }

  if (bolha.tipo === "localizacao") {
    // Sem chave de mapa embutida e sem pedir uma: o link universal do Google
    // abre no app nativo em celular, que é onde o vendedor está quando precisa
    // chegar no endereço.
    const mapa = `https://www.google.com/maps/search/?api=1&query=${bolha.latitude},${bolha.longitude}`;
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="font-medium">{bolha.nome ?? "Localização"}</span>
        </div>
        {bolha.endereco && (
          <p className="text-xs text-muted-foreground break-words">{bolha.endereco}</p>
        )}
        <a
          href={mapa}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs underline underline-offset-2 hover:opacity-80"
        >
          Abrir no mapa
        </a>
      </div>
    );
  }

  if (bolha.tipo === "contato") {
    return (
      <div className="space-y-2">
        {bolha.contatos.map((c, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <ContactIcon className="h-4 w-4 shrink-0" />
              <span className="font-medium">{c.nome ?? "Contato"}</span>
            </div>
            {c.telefones.map((t) => (
              <Button
                key={t.numero}
                asChild
                variant="ghost"
                size="sm"
                className="h-auto gap-1.5 px-0 text-xs font-normal"
              >
                <a href={`tel:${t.numero.replace(/[^\d+]/g, "")}`}>
                  <Phone className="h-3 w-3" />
                  {t.numero}
                </a>
              </Button>
            ))}
            {c.emails.map((e) => (
              <p key={e} className="text-xs text-muted-foreground break-all">{e}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return null;
}
