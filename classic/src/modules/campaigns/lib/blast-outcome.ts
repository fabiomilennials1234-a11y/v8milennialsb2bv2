/** Plan completion means all lots were released, not that WhatsApp sent them. */
export function blastOutcome(
  status: string,
  progress?: { total: number; sent: number; failed: number },
) {
  const failed = (progress?.failed ?? 0) > 0;
  if (status === "cancelled") return {
    title: "Disparo cancelado", failed,
    description: "Os lotes ainda não liberados foram interrompidos. Confira os resultados abaixo.",
  };
  if (failed) return {
    title: progress?.failed === progress?.total ? "Disparo com falha" : "Disparo com falhas",
    failed,
    description: "Há mensagens que não foram enviadas. Confira os motivos no relatório abaixo.",
  };
  return {
    title: status === "completed" ? "Lotes liberados" : status === "paused" ? "Disparo pausado" : "Disparo em andamento",
    failed,
    description: "Aceito para envio significa que a mensagem entrou na fila. A confirmação de entrega ainda não está disponível neste relatório.",
  };
}
