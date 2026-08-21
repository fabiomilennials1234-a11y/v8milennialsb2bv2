/**
 * Quem fica como responsável quando o lead nasce pelo chat.
 *
 * Medido em produção (19/08): um master em SHADOW clicou "Criar Lead" e nada
 * aconteceu. `useCurrentTeamMember` devolve a masters e gestores um membro
 * VIRTUAL — id `master-virtual-<uuid>`, que o próprio módulo declara que "NUNCA
 * é persistido em FK" (ADR-0021) — e este caminho o gravava em
 * `responsible_id`/`sdr_id`. O banco recusa, a mutation rejeita, e o handler não
 * tratava erro: a tela ficava exatamente como estava.
 *
 * A regra abaixo é a que decide o valor gravado. Ela é testada aqui porque o
 * defeito não dá erro visível — dá AUSÊNCIA.
 */
import { describe, expect, it } from "vitest";

import { isVirtualTeamMember } from "@/modules/identity";
// ⚠️ IMPORTA a regra que o código usa. A primeira versão deste arquivo a
// REPLICAVA — e teste que copia o predicado segue verde com o defeito vivo.
import { responsavelParaGravar } from "@/modules/communication/lib/lead-responsible";

const MEMBRO_REAL = "8873c853-0000-0000-0000-000000436686";

describe("responsável de lead criado pelo chat", () => {
  it("membro real vira responsável", () => {
    expect(responsavelParaGravar(MEMBRO_REAL)).toBe(MEMBRO_REAL);
  });

  it("MASTER em shadow não vira responsável — o id dele não existe em team_members", () => {
    expect(responsavelParaGravar("master-virtual-1159ea12-e03d-4132-a51e-d53b18ed60fc")).toBeNull();
  });

  it("gestor de portfólio também não — mesma classe de ator", () => {
    expect(responsavelParaGravar("gestor-virtual-1159ea12-e03d-4132-a51e-d53b18ed60fc")).toBeNull();
  });

  it("responsável ESCOLHIDO na tela ganha do ator, inclusive para o master", () => {
    // É assim que o master cria lead COM dono: ele escolhe um membro real no
    // formulário.
    expect(responsavelParaGravar("master-virtual-abc", MEMBRO_REAL)).toBe(MEMBRO_REAL);
  });

  it("sem ator persistível e sem escolha, o lead nasce SEM responsável", () => {
    // Melhor que com responsável inexistente: o lead existe e alguém o assume
    // depois. A alternativa — recusar a criação — tiraria do master a operação
    // que ele foi fazer.
    expect(responsavelParaGravar("master-virtual-abc")).toBeNull();
    expect(responsavelParaGravar(null)).toBeNull();
    expect(responsavelParaGravar(undefined)).toBeNull();
  });
});

describe("isVirtualTeamMember — o predicado que a regra usa", () => {
  it("reconhece os dois prefixos virtuais", () => {
    expect(isVirtualTeamMember("master-virtual-x")).toBe(true);
    expect(isVirtualTeamMember("gestor-virtual-x")).toBe(true);
  });

  it("uuid real não é virtual", () => {
    expect(isVirtualTeamMember(MEMBRO_REAL)).toBe(false);
    expect(isVirtualTeamMember(null)).toBe(false);
    expect(isVirtualTeamMember(undefined)).toBe(false);
  });
});
