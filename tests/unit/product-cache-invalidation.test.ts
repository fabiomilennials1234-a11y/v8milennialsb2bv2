/**
 * Guarda da invalidação de cache de produto.
 *
 * O defeito que isto trava: a página /produtos lê `["products-with-variants", orgId]`,
 * mas as mutations invalidavam só `["products"]`. No TanStack Query v5 o match é por
 * prefixo elemento a elemento — `"products"` não é prefixo de `"products-with-variants"` —
 * então cadastrar produto não atualizava a tela (e o `staleTime` de 5min +
 * `refetchOnWindowFocus:false` de App.tsx faziam nem trocar de aba resolver).
 * O import por planilha invalidava as duas e por isso funcionava; o cadastro manual não.
 *
 * Os dois testes são complementares e ambos falham por mutação:
 *  1. tirar uma chave de `PRODUCT_LIST_QUERY_KEYS` → o teste de comportamento reprova;
 *  2. reintroduzir `invalidateQueries({ queryKey: ["products"] })` inline num caller
 *     → o teste de fonte reprova.
 */
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { invalidateProductQueries } from "@/modules/carteira/hooks/useProducts";

const ORG = "org-test";

describe("invalidateProductQueries", () => {
  it("invalida as DUAS árvores de listagem de produto, não só ['products']", () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(["products", ORG], []);
    queryClient.setQueryData(["products", "active", ORG], []);
    queryClient.setQueryData(["products-with-variants", ORG], []);

    invalidateProductQueries(queryClient);

    expect(queryClient.getQueryState(["products", ORG])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["products", "active", ORG])?.isInvalidated).toBe(true);
    // esta é a que o defeito deixava de fora
    expect(queryClient.getQueryState(["products-with-variants", ORG])?.isInvalidated).toBe(true);
  });

  it("não invalida cache de outro domínio", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["deals", ORG], []);

    invalidateProductQueries(queryClient);

    expect(queryClient.getQueryState(["deals", ORG])?.isInvalidated).toBe(false);
  });
});

/** Arquivos que ESCREVEM em `products` / `product_variants` e precisam invalidar por lá. */
const WRITERS = [
  "src/modules/carteira/hooks/useProducts.ts",
  "src/modules/carteira/hooks/useProductVariants.ts",
  "src/modules/carteira/hooks/useTinyErp.ts",
  "src/modules/carteira/components/product/ProductImportModal.tsx",
];

const INLINE_PRODUCTS_INVALIDATION = /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']products["']\s*\]/;

describe("callers usam o helper, nunca a invalidação inline", () => {
  for (const file of WRITERS) {
    it(`${file} chama invalidateProductQueries`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain("invalidateProductQueries(");
    });

    it(`${file} não invalida ["products"] inline`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(INLINE_PRODUCTS_INVALIDATION.test(source)).toBe(false);
    });
  }
});
