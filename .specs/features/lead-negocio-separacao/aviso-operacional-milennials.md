# Aviso operacional — Milennials (piloto)

**Status:** rascunho, **não enviado**. Enviar é decisão do CTO, e só no mesmo dia em que os nós n8n de ingest forem patchados (L1 item 3) — antes disso o aviso descreve algo que ainda não aconteceu; depois, o time descobre sozinho e liga o suporte.

**Por que existe:** hoje todo lead que chega por formulário/LP entra no funil já virando card. Quando os quatro nós de ingest pararem de mandar `place_in_pipe`, o lead continua chegando — **mas sem card**. Ninguém perde nada; muda quem decide que aquilo virou negócio. O ADR-0023 §3 chama isso de "negócio nasce só por clique humano".

**Janela de convivência (ADR-0023, "o que aceitamos"):** por um tempo o mesmo funil terá cards antigos (criados pelo ingest) e leads novos sem card. Não é bug, e não some sozinho — vai embora quando o time processar os antigos.

---

## Texto sugerido

> A partir de hoje, lead novo de formulário e de landing page cai direto na aba **Leads**, e não mais como card no funil.
>
> O que muda na prática: quem abre o negócio é você. Achou que tem venda ali, clica em criar negócio e ele entra no funil, na etapa que você escolher.
>
> O que **não** muda: nenhum lead deixa de chegar, nada é apagado, e os cards que já estão no funil continuam exatamente onde estão.
>
> Por que fizemos: com todo lead virando card automaticamente, o número do funil era o número de gente que pediu preço — não o de negócio em andamento. Agora o funil conta negócio, e o mesmo cliente pode ter mais de um (inclusive uma recompra, que antes não tinha onde ser registrada).
>
> Nos primeiros dias o funil vai ter as duas coisas convivendo: cards antigos que entraram sozinhos e leads novos esperando alguém abrir. Isso é esperado.
>
> Qualquer coisa estranha, fala com a gente antes de mexer.

---

## Checagem antes de enviar

- [ ] Os quatro nós de ingest já estão patchados (senão o aviso está errado no dia).
- [ ] Alguém da Milennials sabe **onde** fica o botão de criar negócio na aba Leads — o aviso pressupõe que a porta existe e está achável.
- [ ] Combinado quem responde se o time reclamar de "sumiu lead" — o padrão histórico é abrir chamado dizendo que sumiu (ver Labarr, 2026-07-14: rename de etapa lido como perda de 128 leads).
