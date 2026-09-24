FROM denoland/deno:2.7.7
WORKDIR /app
COPY --chown=deno:deno supabase/functions /app/supabase/functions
COPY --chown=deno:deno services/whatsapp-ingress /app/services/whatsapp-ingress
USER deno
RUN deno cache --config services/whatsapp-ingress/deno.json --frozen services/whatsapp-ingress/main.ts
ENV INGRESS_ENABLED=false
EXPOSE 8080
# Queue readiness is independent of provider HTTP admission; never auto-restart
# a dead-letter barrier or consider a merely alive process ready for traffic.
HEALTHCHECK --interval=60s --timeout=15s --start-period=20s --retries=1 CMD deno eval 'try { const r = await fetch(`http://127.0.0.1:${Deno.env.get("PORT") || "8080"}/worker-health`, { signal: AbortSignal.timeout(12000) }); Deno.exit(r.ok ? 0 : 1); } catch { Deno.exit(1); }'
CMD ["sh", "services/whatsapp-ingress/entrypoint.sh"]
