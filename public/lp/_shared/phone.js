/*
 * Telefone das LPs: normaliza, valida e formata. Sem DOM, para a página e o teste usarem o mesmo código
 * (tests/unit/lp-phone.test.ts). O n8n prefixa 55 só em 10 ou 11 dígitos, então a página entrega só DDD + número.
 */
(function (root) {
  "use strict";

  var VALID = /^[1-9]{2}(9\d{8}|[2-9]\d{7})$/;

  /* Tira zero de operadora e DDI 55 antes de cortar. 11 dígitos começando em 55 são DDD 55 real. */
  function digits(raw) {
    var d = String(raw == null ? "" : raw).replace(/\D/g, "").replace(/^0+/, "");
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    return d.slice(0, 11);
  }

  function format(raw) {
    var d = digits(raw);
    if (d.length > 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length > 6) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    if (d.length > 2) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    return d;
  }

  function isValid(raw) {
    return VALID.test(digits(raw));
  }

  root.TorquePhone = { digits: digits, format: format, isValid: isValid };
})(typeof globalThis !== "undefined" ? globalThis : window);
