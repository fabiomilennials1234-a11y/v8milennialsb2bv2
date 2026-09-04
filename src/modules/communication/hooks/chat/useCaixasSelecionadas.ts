/**
 * `useCaixasSelecionadas` — o CONJUNTO de caixas marcadas no seletor do `/chat`.
 *
 * ─── A TELA LEMBRA, MAS NÃO SURPREENDE (decisão 3 do grill) ─────────────────
 *
 * A seleção é persistida POR USUÁRIO, no mesmo formato de chave que a bolha de
 * chat já usa — o produto não pode ter dois comportamentos de memória para a
 * mesma pergunta.
 *
 * Na PRIMEIRA visita depois do deploy não existe nada gravado, e o conjunto
 * nasce com UMA caixa: a que a pessoa já usava (a preferida de
 * `team_members.preferred_whatsapp_instance_id`). Nascer com todas marcadas
 * triplicaria a lista de quem tem 3 números e sextuplicaria a do Café Jurerê sem
 * ninguém ter pedido — a caixa unificada é uma capacidade nova, não um padrão
 * novo imposto.
 *
 * ─── A SELEÇÃO NUNCA FICA VAZIA ─────────────────────────────────────────────
 *
 * Desmarcar a última caixa produziria uma lista em branco indistinguível de
 * "ninguém falou comigo" — que é exatamente o defeito que o épico existe para
 * matar. Desmarcar a última é ignorado, e o saneamento (caixa que saiu do
 * conjunto permitido) cai na primeira caixa disponível em vez de esvaziar.
 *
 * ─── INSTAGRAM ABRE SOZINHO (até a W5) ──────────────────────────────────────
 *
 * `get_social_conversation_list` ainda não aplica o recorte por responsável, e
 * duas orgs têm `chat_restrict_to_owner` ligado — uma delas com 10.175 mensagens
 * de Instagram em 90 dias. Enquanto o furo não fecha, o canal de Instagram não
 * entra num conjunto: marcá-lo desmarca o resto, e marcar outra caixa o desmarca.
 * `exclusiva` diz à UI que houve essa troca, para ela explicar em vez de a
 * seleção parecer ter sumido sozinha.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxBox } from "./types";

const CHAVE_PREFIXO = "chat:caixas-marcadas:";

function chaveDoUsuario(userId: string | null | undefined): string | null {
  return userId ? `${CHAVE_PREFIXO}${userId}` : null;
}

function ler(userId: string | null | undefined): string[] | null {
  const chave = chaveDoUsuario(userId);
  if (!chave || typeof localStorage === "undefined") return null;
  try {
    const cru = localStorage.getItem(chave);
    if (!cru) return null;
    const parsed = JSON.parse(cru);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((v): v is string => typeof v === "string");
    // Array gravado vazio é lido como "nada gravado": seleção vazia é estado
    // proibido, e ressuscitá-la de um localStorage corrompido daria uma tela em
    // branco que nenhum clique conserta.
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

function gravar(userId: string | null | undefined, ids: readonly string[]): void {
  const chave = chaveDoUsuario(userId);
  if (!chave || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(chave, JSON.stringify(ids));
  } catch {
    /* QuotaExceededError ou modo privado — a memória é conveniência, não requisito */
  }
}

function ehInstagram(caixa: InboxBox | undefined): boolean {
  return caixa?.kind === "instagram";
}

export interface UseCaixasSelecionadasArgs {
  /** As caixas que a pessoa pode ler. Já vem recortada por org e por membro. */
  caixas: readonly InboxBox[];
  /** A caixa preferida do banco. É com ela que a primeira visita nasce. */
  caixaPreferida?: string | null;
  /** Dono da memória. Sem usuário não há o que lembrar. */
  userId?: string | null;
  /**
   * Segura o padrão enquanto um deep-link ainda vai decidir a caixa.
   *
   * Sem isto, o padrão escolhe uma caixa no primeiro render, a lista dela
   * dispara a RPC, e o link chega depois trocando tudo — a troca de caixa é o
   * que fecha a conversa aberta no shell, e o link acabaria apagando a conversa
   * que ele mesmo abriu.
   */
  suspenso?: boolean;
}

export interface UseCaixasSelecionadasResult {
  /** Ids marcados, na ordem em que as caixas aparecem em `caixas`. */
  marcadas: string[];
  /** As caixas marcadas, já resolvidas. */
  caixasMarcadas: InboxBox[];
  /** `true` quando a seleção é uma caixa de Instagram — que abre sozinha. */
  exclusiva: boolean;
  alternar: (id: string) => void;
  marcarSomente: (id: string) => void;
  marcarTodas: () => void;
  /** `true` enquanto a lista de caixas ainda não chegou. */
  vazio: boolean;
}

export function useCaixasSelecionadas({
  caixas,
  caixaPreferida = null,
  userId = null,
  suspenso = false,
}: UseCaixasSelecionadasArgs): UseCaixasSelecionadasResult {
  const [marcadasCruas, setMarcadasCruas] = useState<string[] | null>(() => ler(userId));

  // Troca de usuário sem recarregar (o master entrando em shadow, por exemplo)
  // relê a memória do novo dono. Sem isto a seleção de um vazaria para a tela do
  // outro até o próximo F5.
  const userAnterior = useRef(userId);
  useEffect(() => {
    if (userAnterior.current === userId) return;
    userAnterior.current = userId;
    setMarcadasCruas(ler(userId));
  }, [userId]);

  const permitidas = useMemo(() => new Set(caixas.map((c) => c.id)), [caixas]);
  const porId = useMemo(() => new Map(caixas.map((c) => [c.id, c])), [caixas]);

  /**
   * O conjunto EFETIVO: o que está gravado, menos o que a pessoa não pode mais
   * ler, com queda para a caixa preferida e daí para a primeira da lista.
   *
   * É derivado a cada render em vez de guardado em estado porque a lista de
   * caixas chega depois do primeiro render — um efeito que "conserta" o estado
   * quando ela chega produz um render a mais com a seleção errada, e é nele que
   * a lista dispara a busca da caixa que a pessoa nem pode abrir.
   */
  const marcadas = useMemo(() => {
    if (caixas.length === 0 || suspenso) return [];

    const sobreviventes = (marcadasCruas ?? []).filter((id) => permitidas.has(id));

    // Instagram é exclusivo: se ele estiver no conjunto junto com outras, quem
    // fica é o resto — a caixa social é a exceção, e a exceção cede.
    const semInstagramCombinado =
      sobreviventes.length > 1
        ? sobreviventes.filter((id) => !ehInstagram(porId.get(id)))
        : sobreviventes;

    const efetivas = semInstagramCombinado.length > 0 ? semInstagramCombinado : [];
    if (efetivas.length > 0) {
      // Ordem da lista de caixas, não a de marcação: o seletor tem uma ordem
      // estável (WhatsApp antes de social) e a lista precisa concordar com ela.
      return caixas.filter((c) => efetivas.includes(c.id)).map((c) => c.id);
    }

    const preferidaValida = caixaPreferida && permitidas.has(caixaPreferida);
    if (preferidaValida) return [caixaPreferida];

    // A mesma ordem de queda que o auto-select tinha antes da multi-seleção:
    // número CONECTADO primeiro (começar numa caixa caída não é opção), depois
    // qualquer número, e só então a caixa social — que é o caso da org que ainda
    // não tem número nenhum. Nunca vazio.
    const conectada = caixas.find((c) => c.kind === "whatsapp" && c.status === "connected");
    const qualquerNumero = caixas.find((c) => c.kind === "whatsapp");
    return [(conectada ?? qualquerNumero ?? caixas[0]).id];
  }, [caixas, marcadasCruas, permitidas, porId, caixaPreferida, suspenso]);

  // Persiste o conjunto EFETIVO, não o cru: assim a caixa que a pessoa perdeu o
  // acesso sai da memória de vez, em vez de reaparecer no dia em que alguém a
  // devolver sem avisar.
  useEffect(() => {
    if (marcadas.length === 0) return;
    gravar(userId, marcadas);
  }, [userId, marcadas]);

  const alternar = useCallback(
    (id: string) => {
      setMarcadasCruas(() => {
        const atual = marcadas;
        const caixa = porId.get(id);

        // Marcar Instagram esvazia o resto; marcar outra coisa tira o Instagram.
        if (ehInstagram(caixa)) return [id];
        const semInstagram = atual.filter((x) => !ehInstagram(porId.get(x)));

        if (semInstagram.includes(id)) {
          const restante = semInstagram.filter((x) => x !== id);
          // Desmarcar a última é sem-op: ver o cabeçalho.
          return restante.length > 0 ? restante : semInstagram;
        }
        return [...semInstagram, id];
      });
    },
    [marcadas, porId],
  );

  const marcarSomente = useCallback((id: string) => setMarcadasCruas([id]), []);

  const marcarTodas = useCallback(() => {
    // "Todas" não inclui Instagram — ele não pode dividir a lista com ninguém
    // até a W5. Uma org só de Instagram mantém o que já tinha.
    const todas = caixas.filter((c) => !ehInstagram(c)).map((c) => c.id);
    if (todas.length > 0) setMarcadasCruas(todas);
  }, [caixas]);

  const caixasMarcadas = useMemo(
    () => marcadas.map((id) => porId.get(id)).filter((c): c is InboxBox => !!c),
    [marcadas, porId],
  );

  return {
    marcadas,
    caixasMarcadas,
    exclusiva: caixasMarcadas.length === 1 && ehInstagram(caixasMarcadas[0]),
    alternar,
    marcarSomente,
    marcarTodas,
    vazio: caixas.length === 0,
  };
}
