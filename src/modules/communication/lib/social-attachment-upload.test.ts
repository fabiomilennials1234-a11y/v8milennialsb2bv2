/**
 * O CAMINHO do anexo é regra de segurança, não arrumação de pastas.
 *
 * A policy `media_insert_org_scoped` do bucket `media` lê `foldername(name)[2]` e
 * exige que aquele segmento seja uma org do usuário. Enquanto o caminho era
 * `notificame/outbound/<org>/…`, o segmento 2 era a palavra "outbound": todo
 * anexo de vendedor voltava como `new row violates row-level security policy`, e
 * o defeito era invisível para master (a policy curto-circuita em
 * `is_master_user()`) e para as edge functions (service_role bypassa RLS).
 *
 * Este teste prende o segmento. Mudou a ordem das pastas, o upload morre em prod.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => uploadMock(...a),
        getPublicUrl: (...a: unknown[]) => getPublicUrlMock(...a),
      }),
    },
  },
}));

import { uploadSocialAttachment } from "./social-attachment-upload";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";

const arquivo = (nome: string, tipo: string) =>
  new File([new Uint8Array(1024)], nome, { type: tipo });

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
  getPublicUrlMock.mockReset();
  getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://cdn/x" } });
});

describe("uploadSocialAttachment — o caminho que a RLS lê", () => {
  it("põe a org no SEGUNDO segmento, que é onde a policy procura", async () => {
    await uploadSocialAttachment(arquivo("tabela.pdf", "application/pdf"), ORG, "whatsapp_oficial");

    const [caminho] = uploadMock.mock.calls[0];
    expect(String(caminho).split("/")[1]).toBe(ORG);
  });

  it("mantém o prefixo do canal e um nome não-adivinhável", async () => {
    await uploadSocialAttachment(arquivo("tabela de preço.pdf", "application/pdf"), ORG, "whatsapp_oficial");

    const caminho = String(uploadMock.mock.calls[0][0]);
    expect(caminho).toMatch(
      new RegExp(`^notificame/${ORG}/outbound/[0-9a-f-]{36}-[\\w.-]+$`),
    );
  });

  it("não sobe nada quando o anexo é recusado pela regra do canal", async () => {
    await expect(
      uploadSocialAttachment(arquivo("doc.pdf", "application/pdf"), ORG, "instagram"),
    ).rejects.toThrow();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
