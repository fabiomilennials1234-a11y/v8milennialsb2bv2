import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPixButtonBody } from "./uazapi-pix.ts";

Deno.test("REGRESSÃO: mapeia pros nomes reais da Uazapi (pixKey/pixType/pixName)", () => {
  const body = buildPixButtonBody({
    number: "5548999325726",
    pixkey: "30.090.454/0001-61",
    pixkeyType: "cnpj",
    merchantName: "Pizzaria GranPizza",
    amount: 100,
  });
  // Nomes que a Uazapi exige — sem isso dava "Missing required fields".
  assertEquals(body.pixKey, "30.090.454/0001-61");
  assertEquals(body.pixType, "CNPJ");
  assertEquals(body.pixName, "Pizzaria GranPizza");
  assertEquals(body.number, "5548999325726");
  // Não manda os nomes internos errados nem amount (pix-button não tem valor).
  assertEquals("pixkey" in body, false);
  assertEquals("pixkeyType" in body, false);
  assertEquals("merchantName" in body, false);
  assertEquals("amount" in body, false);
});

Deno.test("random → EVP", () => {
  const body = buildPixButtonBody({
    number: "5548999325726",
    pixkey: "abc-123",
    pixkeyType: "random",
    merchantName: "Loja X",
    amount: 0,
  });
  assertEquals(body.pixType, "EVP");
});

Deno.test("text opcional é incluído só quando presente", () => {
  const withText = buildPixButtonBody({
    number: "n", pixkey: "k", pixkeyType: "email", merchantName: "m", amount: 1, text: "Pague aqui",
  });
  assertEquals(withText.text, "Pague aqui");
  const without = buildPixButtonBody({
    number: "n", pixkey: "k", pixkeyType: "email", merchantName: "m", amount: 1,
  });
  assertEquals("text" in without, false);
});
