// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { encryptMetaToken, decryptMetaToken, storedMetaToken } from "../../supabase/functions/_shared/meta-token-crypto";
const binding={appId:"123",organizationId:"org-a",asset:"page:42"};
describe("Meta token encryption",()=>{
 it("uses random authenticated encryption and binds app, tenant and asset",async()=>{
  vi.stubGlobal("Deno",{env:{get:()=>"a".repeat(64)}});
  const a=await encryptMetaToken("private-token",binding), b=await encryptMetaToken("private-token",binding);
  expect(a).not.toBe(b);expect(a).not.toContain("private-token");expect(await decryptMetaToken(a,binding)).toBe("private-token");
  for(const other of [{...binding,appId:"999"},{...binding,organizationId:"org-b"},{...binding,asset:"page:43"}]) await expect(decryptMetaToken(a,other)).rejects.toThrow("meta_token_decryption_failed");
  const pieces=a.split(".");pieces[2]=(pieces[2][0]==="A"?"B":"A")+pieces[2].slice(1);await expect(decryptMetaToken(pieces.join("."),binding)).rejects.toThrow("meta_token_decryption_failed");
  await expect(storedMetaToken("plaintext","123","org-a","page:42")).rejects.toThrow();expect(await storedMetaToken("legacy",null,"org-a","page:42")).toBe("legacy");
 });
 it("fails closed without a valid independent encryption key",async()=>{
  vi.stubGlobal("Deno",{env:{get:()=>undefined}});await expect(encryptMetaToken("token",binding)).rejects.toThrow("meta_encryption_not_configured");
 });
});
