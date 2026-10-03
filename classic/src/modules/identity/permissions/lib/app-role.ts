/**
 * O vocabulário de `team_members.role`, em um lugar só.
 *
 * POR QUE ISTO VIVE EM `src/` E NÃO EM `tests/` (#1541)
 * -----------------------------------------------------
 * A amarra útil é de TIPO: se o enum `app_role` ganhar ou perder um valor,
 * alguma coisa tem que parar de compilar. Mas `tsconfig.app.json` tem
 * `"include": ["src"]` — o diretório `tests/` **não é type-checked**. Uma
 * asserção de tipo escrita lá seria decorativa: nunca reprovaria o
 * `typecheck:ratchet`, e o dia em que o enum mudasse ninguém saberia.
 *
 * Então o vocabulário mora aqui, onde o compilador olha, e o teste
 * (`tests/unit/role-vocabulary.test.ts`) confere o runtime contra o catálogo.
 *
 * O DEFEITO QUE ISTO EXISTE PARA IMPEDIR
 * --------------------------------------
 * Um gate comparava `role === "membro"`. O banco guarda `member`. A comparação
 * nunca casava e negava todo não-admin em silêncio (#834). A doc do repositório
 * dizia "roles: admin, master, membro" — errado em dois dos três valores — e
 * quem escreveu o gate obedeceu à doc.
 */

import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

/**
 * Exaustivo de propósito: `Record<AppRole, true>` obriga uma chave por valor do
 * enum. Regenerar `types.ts` depois de mexer no enum quebra AQUI, no
 * `typecheck`, antes de qualquer runtime.
 */
const LEGAL: Record<AppRole, true> = {
  admin: true,
  sdr: true,
  closer: true,
  agency: true,
  bdr: true,
  cliente: true,
  member: true,
};

/** Os valores legais de `team_members.role`, derivados do enum. */
export const APP_ROLES = Object.keys(LEGAL) as AppRole[];

/**
 * `master` **não** está aqui, e a ausência é o ponto: master não é um role, é
 * uma camada acima (`is_master_user()`, `useMasterAuth()`). Tratar master como
 * valor de role é a mesma confusão que produziu o #1541.
 */
export function isAppRole(value: string): value is AppRole {
  return Object.prototype.hasOwnProperty.call(LEGAL, value);
}
