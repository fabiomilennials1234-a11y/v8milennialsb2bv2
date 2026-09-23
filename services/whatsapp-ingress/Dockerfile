FROM denoland/deno:2.7.7
WORKDIR /app
COPY --chown=deno:deno supabase/functions /app/supabase/functions
COPY --chown=deno:deno services/whatsapp-ingress /app/services/whatsapp-ingress
USER deno
RUN deno cache --config services/whatsapp-ingress/deno.json --frozen services/whatsapp-ingress/main.ts
ENV INGRESS_ENABLED=false
EXPOSE 8080
CMD ["sh", "services/whatsapp-ingress/entrypoint.sh"]
