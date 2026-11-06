/*
 * Atribuição enviada ao Cal.com como metadata da reserva: o n8n lê de `payload.metadata` no webhook do evento.
 * Sem DOM, para a página e o teste usarem o mesmo código (tests/unit/lp-cal-metadata.test.ts).
 * Da URL só saem parâmetros de campanha, nunca dado pessoal. O teto de 500 caracteres por valor é o da API v2 do Cal,
 * mantido como defesa: o caminho web não tem esse limite.
 */
(function (root) {
  "use strict";

  var MAX_VALUE = 500;
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var PAGE_PARAMS = UTM_KEYS.concat(["fbclid", "gclid"]);

  function clean(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  /* Corte que não parte emoji: metade de um par substituto faz o encodeURIComponent lançar. */
  function cut(value) {
    var text = value.slice(0, MAX_VALUE);
    var last = text.charCodeAt(text.length - 1);
    return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
  }

  /* Só http(s): android-app:// e about:blank têm origin "null", que viraria lixo no CRM. */
  function parseUrl(raw) {
    try {
      var url = new URL(clean(raw));
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch (e) { return null; }
  }

  /* Caminho longo demais termina na última barra que couber. */
  function fitPath(base) {
    if (base.length <= MAX_VALUE) return base;
    return base.slice(0, base.lastIndexOf("/", MAX_VALUE - 1) + 1);
  }

  /* Só parâmetros de campanha, e cada um inteiro: o que não couber fica de fora. */
  function pageValue(raw) {
    var url = parseUrl(raw);
    if (!url) return "";
    var value = fitPath(url.origin + url.pathname);
    var sep = "?";
    url.searchParams.forEach(function (v, k) {
      if (PAGE_PARAMS.indexOf(k) === -1 || !clean(v)) return;
      var next = value + sep + k + "=" + encodeURIComponent(v);
      if (next.length > MAX_VALUE) return;
      value = next;
      sep = "&";
    });
    return value;
  }

  function referrerValue(raw) {
    var url = parseUrl(raw);
    return url ? fitPath(url.origin + url.pathname) : "";
  }

  function build(input) {
    var meta = {};
    var set = function (key, value) { if (value) meta[key] = value; };
    /* Identificador cortado não casa na Meta: sai inteiro ou não sai. */
    var whole = function (value) { var v = clean(value); return v.length <= MAX_VALUE ? v : ""; };
    set("lp", cut(clean(input.lp)));
    set("pagina", pageValue(input.url));
    set("referrer", referrerValue(input.referrer));
    var url = parseUrl(input.url);
    UTM_KEYS.forEach(function (key) {
      set(key, url ? cut(clean(url.searchParams.get(key))) : "");
    });
    set("fbp", whole(input.fbp));
    set("fbc", whole(input.fbc));
    return meta;
  }

  function toConfig(meta) {
    var config = {};
    Object.keys(meta).forEach(function (key) { config["metadata[" + key + "]"] = meta[key]; });
    return config;
  }

  function toQuery(meta) {
    return Object.keys(meta).map(function (key) {
      return "metadata[" + key + "]=" + encodeURIComponent(meta[key]);
    }).join("&");
  }

  function withQuery(base, meta) {
    var query = toQuery(meta);
    return query ? base + "?" + query : base;
  }

  root.TorqueCalMetadata = { MAX_VALUE: MAX_VALUE, build: build, toConfig: toConfig, toQuery: toQuery, withQuery: withQuery };
})(typeof globalThis !== "undefined" ? globalThis : window);
