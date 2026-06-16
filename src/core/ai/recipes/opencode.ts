import type { Recipe } from '../types.ts';

/**
 * OpenCode Zen is an AI gateway for OpenCode-curated models. This recipe covers
 * Zen models served through its OpenAI-compatible /chat/completions endpoint.
 * Zen also exposes some models through /responses, /messages, or provider-
 * native endpoints; those need separate gateway implementations before gbrain
 * can route to them.
 */
export const opencode: Recipe = {
  id: 'opencode',
  name: 'OpenCode Zen',
  tier: 'openai-compat',
  implementation: 'openai-compatible',
  base_url_default: 'https://opencode.ai/zen/v1',
  auth_env: {
    required: ['OPENCODE_API_KEY'],
    optional: ['OPENCODE_BASE_URL'],
    setup_url: 'https://opencode.ai/zen',
  },
  touchpoints: {
    expansion: {
      // gbrain expansion uses the same OpenAI-compatible chat-completions
      // transport as chat. Zen does not support AI SDK structured outputs
      // here, so gateway.expand falls back to text JSON parsing.
      models: [
        'deepseek-v4-flash',
        'deepseek-v4-pro',
        'minimax-m2.7',
        'minimax-m2.5',
        'glm-5.1',
        'glm-5',
        'kimi-k2.5',
        'kimi-k2.6',
        'big-pickle',
      ],
      cost_per_1m_tokens_usd: 0.28,
      supports_structured_outputs: false,
      price_last_verified: '2026-06-16',
    },
    chat: {
      // Curated from Zen's OpenAI-compatible /chat/completions table
      // (verified 2026-06-16). The openai-compat tier accepts arbitrary
      // model ids too, so this list is discoverability, not enforcement.
      models: [
        'deepseek-v4-pro',
        'deepseek-v4-flash',
        'minimax-m2.7',
        'minimax-m2.5',
        'glm-5.1',
        'glm-5',
        'kimi-k2.5',
        'kimi-k2.6',
        'grok-build-0.1',
        'big-pickle',
        'mimo-v2.5-free',
        'north-mini-code-free',
        'nemotron-3-ultra-free',
        'deepseek-v4-flash-free',
      ],
      supports_tools: true,
      supports_subagent_loop: true,
      supports_prompt_cache: false,
      max_context_tokens: 128000,
      // Baseline for deepseek-v4-flash; per-model pricing lives in
      // src/core/model-pricing.ts when known.
      cost_per_1m_input_usd: 0.14,
      cost_per_1m_output_usd: 0.28,
      price_last_verified: '2026-06-16',
    },
  },
  setup_hint:
    'Get an OpenCode Zen API key at https://opencode.ai/zen, then `export OPENCODE_API_KEY=...` and use `opencode:deepseek-v4-flash` (or any Zen /chat/completions model).',
};
