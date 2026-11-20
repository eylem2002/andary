// API list prices, to estimate what Claude Code's tokens would cost (CONTRACTS §4.8). Shared by
// the server, which prices real transcripts, and the demo. On a subscription plan nobody pays
// these per token; the town says "estimated at API prices".

/** US dollars per million tokens: input, output, cache read. Cache writes cost 1.25× input (5 min) or 2× (1 h). */
const PRICES = Object.freeze([
  // Checked 2026-11-20 against Anthropic's pricing page and launch notes.
  { match: /haiku-5-5/, input: 0.1, output: 0.5, cacheRead: 0.01, long: { input: 0.5, output: 2.5, cacheRead: 0.05 } },
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2 },
  { match: /sonnet-5-5/, input: 2, output: 10, cacheRead: 0.1 },
  { match: /(fable|mythos)-5-2/, input: 8, output: 40, cacheRead: 0.8 },
  { match: /fable-5-1/, input: 10, output: 50, cacheRead: 1 },
  { match: /sonnet-5(?!-5)/, input: 2, output: 10, cacheRead: 0.2 },
  { match: /opus-(5(?!-5)|4)/, input: 5, output: 25, cacheRead: 0.5 },
  { match: /sonnet-4/, input: 3, output: 15, cacheRead: 0.3 },
  { match: /haiku-4/, input: 1, output: 5, cacheRead: 0.1 },
]);
/** Haiku 5.5 bills prompts over this many tokens at its higher rate. */
const LONG_PROMPT_TOKENS = 100_000;

/**
 * The estimated cost of one message's usage, or null for a model without a known price.
 * @param {string} model
 * @param {{ input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number, cache_creation?: { ephemeral_5m_input_tokens?: number, ephemeral_1h_input_tokens?: number } }} usage
 * @returns {number|null}
 */
export function messageCost(model, usage) {
  const price = PRICES.find((entry) => entry.match.test(String(model)));
  if (!price) return null;
  const input = count(usage.input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const write1h = count(usage.cache_creation?.ephemeral_1h_input_tokens);
  const write5m = usage.cache_creation ? count(usage.cache_creation.ephemeral_5m_input_tokens) : count(usage.cache_creation_input_tokens);
  const rates = price.long && input + cacheRead + write5m + write1h > LONG_PROMPT_TOKENS ? price.long : price;
  return (input * rates.input + write5m * rates.input * 1.25 + write1h * rates.input * 2 + cacheRead * rates.cacheRead + count(usage.output_tokens) * rates.output) / 1e6;
}

/** @param {unknown} n */
function count(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}
