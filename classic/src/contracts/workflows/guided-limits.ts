export const GUIDED_CONDITION_LIMITS = Object.freeze({
  maxComplexity: 100,
  maxGroupDepth: 3,
  maxSequentialReaders: 20,
  maxPeriodMs: 366 * 86_400_000,
  maxMessageExpressions: 20,
  maxMessageExpressionLength: 120,
  maxNormalizedExpressionLength: 1_000,
  maxMessageCandidates: 50,
  serverTimeoutMs: 10_000,
  uiTimeoutMs: 12_000,
});
