/*
 * Meta Pixel das LPs, o mesmo do nó `Enviar à Meta CAPI`. Snippet oficial, em arquivo para não depender de
 * script inline. Script bloqueado ou com falha não afeta a página: `fbq` fica só acumulando na fila.
 * As conversões (Lead e Schedule) saem de lp.js, com o event_id que também vai ao webhook.
 */
(function () {
  "use strict";

  var PIXEL_ID = "1588170885997511";

  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  try {
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  } catch (e) { /* pixel é opcional */ }
})();
