/**
 * Nome original do documento no chat (Chamado f6fc3c9e).
 *
 * A bolha mostrava o basename da URL: um sha256 de 64 hex ou um link `.enc?…`
 * do CDN do WhatsApp. O nome real chega em `raw_payload.content.fileName`, mas
 * o payload é apagado com 14 dias — por isso a coluna `media_file_name` vem
 * primeiro. Estes testes travam a ordem e, principalmente, que o helper NUNCA
 * devolve um hash ou um link cifrado como se fosse nome.
 */
import { describe, it, expect } from "vitest";
import { readDocumentFileName } from "./documentFileName";

const HASH = "b8bd6f2750fa4c1e9d0a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4d82c3";

describe("readDocumentFileName", () => {
  it("prefere a coluna persistida", () => {
    expect(
      readDocumentFileName({
        media_file_name: "Pedido JURERE - 03.10.26.pdf",
        raw_payload: { content: { fileName: "outro.pdf" } },
        media_url: `https://x.supabase.co/storage/v1/object/public/media/${HASH}.pdf`,
      }),
    ).toBe("Pedido JURERE - 03.10.26.pdf");
  });

  it("cai no raw_payload.content.fileName (linha de realtime sem a coluna)", () => {
    expect(
      readDocumentFileName({
        raw_payload: { content: { fileName: "Boleto.pdf", title: "x" } },
        media_url: `https://x/${HASH}.pdf`,
      }),
    ).toBe("Boleto.pdf");
  });

  it("usa content.title quando não há fileName", () => {
    expect(readDocumentFileName({ raw_payload: { content: { title: "Contrato.docx" } } })).toBe("Contrato.docx");
  });

  it("usa document.filename (formato Meta Cloud API)", () => {
    expect(readDocumentFileName({ raw_payload: { document: { filename: "NF.xml" } } })).toBe("NF.xml");
  });

  it("deriva o nome da URL de upload do CRM, tirando o sufixo de timestamp", () => {
    expect(
      readDocumentFileName({
        media_url:
          "https://x.supabase.co/storage/v1/object/public/media/whatsapp-media/4922638c-4909-494e-ba10-12282ec0b161/2f1c7a7e-1111-4111-8111-111111111111/tabela_precos.pdf_1759700000000.pdf",
      }),
    ).toBe("tabela_precos.pdf");
  });

  it("acrescenta a extensão quando o nome do upload não a tinha", () => {
    expect(
      readDocumentFileName({
        media_url: "https://x/media/whatsapp-media/org/uuid/tabela_1759700000000.pdf",
      }),
    ).toBe("tabela.pdf");
  });

  it("upload do CRM sem nome original (document_<ts>) não vira nome", () => {
    expect(
      readDocumentFileName({
        media_url: "https://x/media/whatsapp-media/org/uuid/document_1759700000000_1759700000000.pdf",
      }),
    ).toBeNull();
  });

  it("nunca devolve hash sha256", () => {
    expect(readDocumentFileName({ media_url: `https://x/media/${HASH}.pdf` })).toBeNull();
  });

  it("nunca devolve link .enc do CDN do WhatsApp", () => {
    expect(
      readDocumentFileName({
        media_url: "https://mmg.whatsapp.net/v/t62.7119-24/838502491_123_n.enc?ccb=11-4&oh=abc&oe=def",
      }),
    ).toBeNull();
  });

  it("ignora nome vazio ou só espaço e segue para o próximo", () => {
    expect(
      readDocumentFileName({ media_file_name: "  ", raw_payload: { content: { fileName: "A.pdf" } } }),
    ).toBe("A.pdf");
  });

  it("sem nada devolve null", () => {
    expect(readDocumentFileName({})).toBeNull();
    expect(readDocumentFileName({ media_url: null, raw_payload: null, media_file_name: null })).toBeNull();
  });
});
