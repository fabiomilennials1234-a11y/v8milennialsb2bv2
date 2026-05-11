/**
 * chatQueryKeys — fábrica única de queryKeys do domínio Chat WhatsApp.
 * Testa idempotência, distinção por args, normalização de null/undefined,
 * e estabilidade de tuple shape (TanStack Query exige imutabilidade estrutural).
 */
import { describe, it, expect } from "vitest";
import { chatQueryKeys } from "@/hooks/chat/shared/queryKeys";

describe("chatQueryKeys", () => {
  describe("messages()", () => {
    it("produz tuple com shape correto", () => {
      const key = chatQueryKeys.messages("org-a", "5511999", "inst-1");
      expect(key).toEqual(["whatsapp_messages", "org-a", "5511999", "inst-1"]);
    });

    it("idempotente — args iguais produzem keys equal-by-value", () => {
      const k1 = chatQueryKeys.messages("org-a", "5511999", "inst-1");
      const k2 = chatQueryKeys.messages("org-a", "5511999", "inst-1");
      expect(k1).toEqual(k2);
    });

    it("orgId distinto → keys distintas", () => {
      const k1 = chatQueryKeys.messages("org-a", "p", "i");
      const k2 = chatQueryKeys.messages("org-b", "p", "i");
      expect(k1).not.toEqual(k2);
    });

    it("instanceId distinto → keys distintas", () => {
      const k1 = chatQueryKeys.messages("org-a", "p", "i1");
      const k2 = chatQueryKeys.messages("org-a", "p", "i2");
      expect(k1).not.toEqual(k2);
    });

    it("phone distinto → keys distintas", () => {
      const k1 = chatQueryKeys.messages("org-a", "111", "i");
      const k2 = chatQueryKeys.messages("org-a", "222", "i");
      expect(k1).not.toEqual(k2);
    });

    it("normaliza null/undefined para null", () => {
      expect(chatQueryKeys.messages(null, null, null)).toEqual([
        "whatsapp_messages",
        null,
        null,
        null,
      ]);
      expect(chatQueryKeys.messages(undefined, undefined, undefined)).toEqual([
        "whatsapp_messages",
        null,
        null,
        null,
      ]);
    });
  });

  describe("contacts()", () => {
    it("shape correto", () => {
      const key = chatQueryKeys.contacts("org-a", "inst-1");
      expect(key).toEqual(["whatsapp_contacts", "org-a", "inst-1"]);
    });

    it("idempotente", () => {
      expect(chatQueryKeys.contacts("a", "b")).toEqual(chatQueryKeys.contacts("a", "b"));
    });

    it("instanceId distinto → keys distintas", () => {
      expect(chatQueryKeys.contacts("a", "x")).not.toEqual(chatQueryKeys.contacts("a", "y"));
    });

    it("normaliza nullish", () => {
      expect(chatQueryKeys.contacts(undefined, null)).toEqual([
        "whatsapp_contacts",
        null,
        null,
      ]);
    });
  });

  describe("leadWhatsAppInstance()", () => {
    it("shape correto", () => {
      expect(chatQueryKeys.leadWhatsAppInstance("11999")).toEqual([
        "lead-whatsapp-instance",
        "11999",
      ]);
    });

    it("normaliza nullish para null", () => {
      expect(chatQueryKeys.leadWhatsAppInstance(null)).toEqual([
        "lead-whatsapp-instance",
        null,
      ]);
    });
  });

  describe("chatDeepLink()", () => {
    it("shape correto", () => {
      const key = chatQueryKeys.chatDeepLink("org-a", "5511999", "i1,i2");
      expect(key).toEqual(["chat-deep-link", "org-a", "5511999", "i1,i2"]);
    });

    it("allowedInstanceIdsCsv distinto → keys distintas", () => {
      expect(chatQueryKeys.chatDeepLink("a", "p", "i1")).not.toEqual(
        chatQueryKeys.chatDeepLink("a", "p", "i2"),
      );
    });
  });

  describe("failed()", () => {
    it("shape correto", () => {
      expect(chatQueryKeys.failed("org-a", "11999")).toEqual([
        "whatsapp_failed_messages",
        "org-a",
        "11999",
      ]);
    });

    it("idempotente", () => {
      expect(chatQueryKeys.failed("a", "p")).toEqual(chatQueryKeys.failed("a", "p"));
    });
  });

  describe("cross-factory distinction", () => {
    it("messages e contacts com mesma org+instance produzem keys distintas (prefixo)", () => {
      const m = chatQueryKeys.messages("org-a", null, "inst-1");
      const c = chatQueryKeys.contacts("org-a", "inst-1");
      expect(m[0]).not.toEqual(c[0]);
    });
  });
});
