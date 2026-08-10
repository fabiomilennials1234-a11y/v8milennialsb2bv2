import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { shouldPersistMedia } from "./group-media-gate.ts";

// URL real de mídia criptografada do CDN do WhatsApp (formato que o
// isWhatsAppCdnUrlShared reconhece). Sem host válido o gate recusa por outro
// motivo e o teste passaria sem provar nada sobre grupo.
const CDN_URL = "https://mmg.whatsapp.net/v/t62.7118-24/12345_n.enc?ccb=11-4&oh=abc&oe=123";

Deno.test("grupo com mídia de CDN não persiste — era 40 GB dos 100 GB do bucket", () => {
  assertEquals(
    shouldPersistMedia({
      is_group: true,
      media_url: CDN_URL,
      message_id: "3EB0ABCDEF",
    }),
    false,
  );
});

Deno.test("conversa individual com a MESMA mídia persiste", () => {
  // Par de controle do teste acima: idêntico exceto is_group. Sem ele, um gate
  // que recusasse tudo (por URL não reconhecida, por exemplo) passaria como se
  // fosse o filtro de grupo funcionando.
  assertEquals(
    shouldPersistMedia({
      is_group: false,
      media_url: CDN_URL,
      message_id: "3EB0ABCDEF",
    }),
    true,
  );
});

Deno.test("mensagem sem mídia não persiste", () => {
  assertEquals(
    shouldPersistMedia({ is_group: false, media_url: null, message_id: "3EB0ABCDEF" }),
    false,
  );
});

Deno.test("mídia sem message_id não persiste — o path do Storage é derivado dele", () => {
  assertEquals(
    shouldPersistMedia({ is_group: false, media_url: CDN_URL, message_id: null }),
    false,
  );
});

Deno.test("URL que não é do CDN do WhatsApp não persiste", () => {
  // Já-no-Storage ou link externo: rebaixar seria duplicar.
  assertEquals(
    shouldPersistMedia({
      is_group: false,
      media_url: "https://jsjsmuncfkbsbzqzqhfq.supabase.co/storage/v1/object/public/media/x.jpg",
      message_id: "3EB0ABCDEF",
    }),
    false,
  );
});

Deno.test("grupo continua recusado mesmo com URL não-CDN", () => {
  assertEquals(
    shouldPersistMedia({
      is_group: true,
      media_url: "https://exemplo.com/foto.jpg",
      message_id: "3EB0ABCDEF",
    }),
    false,
  );
});
