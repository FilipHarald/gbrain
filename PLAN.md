# First-Class OpenCode Zen Provider Support

## Goal

Add first-class support for OpenCode Zen as an AI gateway completion provider so users can use an `OPENCODE_API_KEY` for gbrain's internal LLM work instead of requiring Anthropic API keys for normal synthesis, extraction, reasoning, and gateway-native agent loops.

In gbrain's code, `chat` means an internal LLM completion call through the AI gateway. It does not mean gbrain has a user-facing chat UI. OpenClaw/opencode/Claude/Codex can still be the client talking to gbrain over MCP; this provider is for gbrain's own processing/dream/synthesis calls.

Zen exposes multiple endpoint families. This plan covers the Zen models served through the OpenAI-compatible chat completions API:

- Base URL: `https://opencode.ai/zen/v1`
- Chat endpoint: `/chat/completions`
- Example model IDs: `deepseek-v4-pro`, `deepseek-v4-flash`, `minimax-m2.7`, `glm-5.1`, `kimi-k2.6`, `grok-build-0.1`

Zen also exposes other models through `/responses`, `/messages`, or provider-native endpoints. Those are out of scope for this OpenAI-compatible recipe unless gbrain later adds separate implementations for those endpoint shapes.

The existing short-term workaround is to point the `deepseek` recipe at Zen:

```bash
export DEEPSEEK_API_KEY="$OPENCODE_API_KEY"
gbrain config set provider_base_urls.deepseek https://opencode.ai/zen/v1
gbrain config set models.tier.reasoning deepseek:deepseek-v4-pro
```

This works structurally, but it is confusing and hides the real provider/key behind DeepSeek names. First-class support should make the configuration honest and discoverable.

## Current State

- `src/core/ai/gateway.ts` already supports OpenAI-compatible chat providers through `createOpenAICompatible`.
- `src/core/ai/recipes/deepseek.ts` shows the exact shape needed for a chat-only OpenAI-compatible provider.
- `src/core/ai/recipes/index.ts` is the recipe registry.
- `src/core/ai/build-gateway-config.ts` currently maps only selected file-plane keys into gateway env (`openai`, `anthropic`, `zeroentropy`) and maps selected `*_BASE_URL` env vars into `base_urls`.
- `src/core/config.ts` likely needs a new optional `opencode_api_key` field if we want `gbrain config set opencode_api_key ...` to work like existing key config.
- `src/core/model-pricing.ts` has DeepSeek pricing for `deepseek:deepseek-chat`, but not Zen's `opencode:*` model IDs.
- The legacy budget tracker still routes chat pricing through an Anthropic-derived table, so `--max-cost` behavior for non-Anthropic/Zen models needs explicit attention.

## Proposed Implementation

1. Add a new recipe: `src/core/ai/recipes/opencode.ts`

   Shape:

   ```ts
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
       chat: {
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
         price_last_verified: '<date checked>',
       },
     },
     setup_hint:
       'Get an OpenCode Zen API key at https://opencode.ai/zen, then `export OPENCODE_API_KEY=...` and use `opencode:deepseek-v4-flash` (or any Zen /chat/completions model).',
   };
   ```

   Notes:

   - Free Zen models should be documented as unsafe for private brain data if Zen's current privacy language still says free-period requests may be collected or retained.
   - OpenAI-compatible recipe model lists are advisory in gbrain; arbitrary `opencode:<model-id>` values should be accepted and left for Zen to validate.

2. Register the recipe in `src/core/ai/recipes/index.ts`.

3. Add config/env plumbing.

   Update `src/core/config.ts`:

   - Add optional `opencode_api_key?: string`.
   - Add it to accepted config keys if needed.
   - Ensure `gbrain config set opencode_api_key ...` is allowed and stored.

   Update `src/core/ai/build-gateway-config.ts`:

   - Map `c.opencode_api_key` to `OPENCODE_API_KEY`.
   - Map `process.env.OPENCODE_BASE_URL` to `base_urls.opencode`.

   This gives users both env and config-file paths:

   ```bash
   export OPENCODE_API_KEY=...
   ```

   or:

   ```bash
   gbrain config set opencode_api_key ...
   ```

4. Add model routing examples to docs.

   Suggested config:

   ```bash
   gbrain config set models.tier.utility opencode:deepseek-v4-flash
   gbrain config set models.tier.reasoning opencode:deepseek-v4-pro
   gbrain config set models.tier.deep opencode:deepseek-v4-pro
   gbrain config set agent.use_gateway_loop true
   ```

   Consider adding this to:

   - `docs/integrations/embedding-providers.md` or a new AI provider guide if chat providers have a better home.
   - `docs/architecture/KEY_FILES.md` only if this repo keeps that generated/curated file current manually.
   - `skills/conventions/model-routing.md` if the skill docs should advertise Zen as a routing option.

5. Add pricing support.

   Update `src/core/model-pricing.ts` with paid Zen `/chat/completions` model prices where Zen publishes stable pricing.

   Then fix or extend `src/core/budget/budget-tracker.ts` so chat pricing uses the canonical multi-provider lookup instead of only the Anthropic-derived view. There is already repo context indicating this is a known gap for non-Anthropic budget tracking.

   Free models should not be added to the positive-price canonical table; leave them unpriced or handle free-provider policy explicitly.

6. Add tests.

   Unit/shape tests:

   - `test/ai/recipe-opencode.test.ts`
     - recipe is registered
     - implementation is `openai-compatible`
     - auth requires `OPENCODE_API_KEY`
     - base URL is `https://opencode.ai/zen/v1`
     - chat models include representative Zen `/chat/completions` IDs
     - arbitrary future Zen chat-completions model IDs are accepted
     - `applyResolveAuth` produces a bearer auth path
     - missing key produces `AIConfigError`

   Build config tests:

   - Extend `test/ai/build-gateway-config.test.ts`
     - `OPENCODE_BASE_URL` flows to `base_urls.opencode`
     - config wins over env for `provider_base_urls.opencode`
     - `opencode_api_key` maps to `OPENCODE_API_KEY`

   Gateway tests:

   - Add or extend a chat transport test to confirm `opencode:<model>` routes through `createOpenAICompatible` with the configured base URL and auth.

   Budget/pricing tests:

   - If pricing is added, assert `canonicalLookup('opencode:deepseek-v4-pro')` works.
   - Add coverage for the budget tracker using canonical multi-provider pricing if that gap is fixed in scope.

7. Optional live smoke test.

   With a real Zen key:

   ```bash
   OPENCODE_API_KEY=... bun test test/ai/recipe-opencode.test.ts
   OPENCODE_API_KEY=... gbrain models doctor opencode:deepseek-v4-flash
   OPENCODE_API_KEY=... gbrain think --model opencode:deepseek-v4-flash "Say ok in JSON"
   OPENCODE_API_KEY=... gbrain think --model opencode:minimax-m2.7 "Say ok in JSON"
   ```

   For tool calling / gateway-native agent loop:

   ```bash
   gbrain config set agent.use_gateway_loop true
   OPENCODE_API_KEY=... gbrain agent run --model opencode:deepseek-v4-flash "Use one read-only brain tool, then summarize."
   ```

## Open Questions

- Does Zen guarantee stable enough tool-call behavior for gateway-native subagent loops across every `/chat/completions` model, or should the docs recommend only specific models for `agent.use_gateway_loop`?
- Should gbrain eventually support Zen's `/responses`, `/messages`, and provider-native endpoint families as separate provider implementations?
- Should the provider id be `opencode` or `zen`? `opencode` is clearer for the API key (`OPENCODE_API_KEY`), while `zen` is shorter for model IDs.
- Should free models be included in the default model list, or omitted to avoid accidental private-data use?

## Suggested First PR Scope

Keep the first PR small:

- Add the `opencode` recipe.
- Register it.
- Add `OPENCODE_API_KEY` / `OPENCODE_BASE_URL` config plumbing.
- Add recipe and build-config tests.
- Add docs with the privacy caveat.

Defer budget-pricing cleanup and subagent-loop certification to follow-up PRs unless they are needed for the first use case.
