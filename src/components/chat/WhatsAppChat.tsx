{(() => {
                  // Deduplicar por message_id (mantém primeira ocorrência; ignora optimistic IDs)
                  const seenIds = new Set<string>();
                  const deduped = messages.filter((m) => {
                    if (!m?.message_id || m.message_id.startsWith("optimistic_")) return true;
                    if (seenIds.has(m.message_id)) return false;
                    seenIds.add(m.message_id);
                    return true;
                  });

                  // Merge deduped messages + transfer events, sorted by timestamp
                  const timeline = [
                    ...deduped.map(m => ({ ...m, _type: 'message' as const })),
                    ...transferEvents.map(e => ({ ...e, _type: 'transfer' as const })),
                  ].sort((a, b) => {
                    const timeA = new Date(a.timestamp).getTime();
                    const timeB = new Date(b.timestamp).getTime();
                    return timeA - timeB;
                  });

                  let lastDate = "";
                  return timeline.map((item, index) => {
                    // Transfer event card
                    if (item._type === 'transfer') {
                      return (
                        <div key={`transfer-${item.id}`} className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/20 border-l-2 border-amber-400 mx-4 my-2 rounded-r">
                          <UserPlus className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Transferido para humano</p>
                            {item.reason && (
                              <p className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</p>
                            )}
                            <p className="text-xs text-amber-500 mt-0.5">
                              {new Date(item.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    // Normal message (preserve existing date separator + MessageBubble logic)
                    const message = item;
                    const ts = message?.timestamp;
                    const date = ts ? new Date(ts) : new Date();
                    const validDate = !Number.isNaN(date.getTime());
                    const msgDate = validDate ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "";
                    const showDateSeparator = msgDate !== lastDate;
                    if (showDateSeparator) lastDate = msgDate;
                    const dateLabel = validDate
                      ? isToday(date)
                        ? "Hoje"
                        : isYesterday(date)
                          ? "Ontem"
                          : format(date, "dd/MM/yyyy", { locale: ptBR })
                      : "";
                    const safeKey = message?.id || `msg-${index}-${ts || index}`;
                    return (
                      <div key={safeKey}>
                        {showDateSeparator && (
                          <div className="flex justify-center py-3">
                            <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                              {dateLabel}
                            </span>
                          </div>
                        )}
                        <MessageBubble
                          message={message}
                          onImagePreview={setPreviewImageUrl}
                        />
                      </div>
                    );
                  });
                })()}