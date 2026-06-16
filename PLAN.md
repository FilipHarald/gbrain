# First-Class OpenCode Zen Provider Support

## Goal

Add first-class support for OpenCode Zen as an AI gateway chat provider so users can use an `OPENCODE_API_KEY` with Zen-hosted DeepSeek models instead of requiring Anthropic API keys for normal chat, reasoning, and gateway-native agent loops.

Zen exposes an OpenAI-compatible chat completions API:

- Base URL: `https://opencode.ai/zen/v1`
- Chat endpoint: `/chat/completions`
- Likely model IDs: `deepseek-v4-pro`, `deepseek-v4-flash`, and `deepseek-v4-flash-free`

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
- `src/core/model-pricing.ts` has DeepSeek pricing for `deepseek:deepseek-chat`, but not Zen's `opencode:deepseek-v4-*` model IDs.
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
       'Get an OpenCode Zen API key at https://opencode.ai/zen, then `export OPENCODE_API_KEY=...` and use `opencode:deepseek-v4-pro`.',
   };
   ```

   Notes:

   - `deepseek-v4-flash-free` should be documented as unsafe for private brain data if Zen's current privacy language still says free-tier requests may be collected or retained.
   - `supports_subagent_loop: true` should be verified with a live tool-call smoke test before relying on it for production agent loops. If not verified, set it to `false` initially and document that `agent.use_gateway_loop` is required but model support is experimental.

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

   Update `src/core/model-pricing.ts` with `opencode:deepseek-v4-pro` and `opencode:deepseek-v4-flash` if Zen publishes stable pricing.

   Then fix or extend `src/core/budget/budget-tracker.ts` so chat pricing uses the canonical multi-provider lookup instead of only the Anthropic-derived view. There is already repo context indicating this is a known gap for non-Anthropic budget tracking.

   If Zen pricing is not stable or published, make `--max-cost` fail closed with a clear `no_pricing` message and document that uncapped calls work.

6. Add tests.

   Unit/shape tests:

   - `test/ai/recipe-opencode.test.ts`
     - recipe is registered
     - implementation is `openai-compatible`
     - auth requires `OPENCODE_API_KEY`
     - base URL is `https://opencode.ai/zen/v1`
     - chat models include the expected Zen DeepSeek IDs
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
   ```

   For tool calling / gateway-native agent loop:

   ```bash
   gbrain config set agent.use_gateway_loop true
   OPENCODE_API_KEY=... gbrain agent run --model opencode:deepseek-v4-flash "Use one read-only brain tool, then summarize."
   ```

## Open Questions

- Does Zen guarantee stable tool-call IDs and replay behavior well enough for `supports_subagent_loop: true`?
- Does Zen publish final pricing for `deepseek-v4-pro` and `deepseek-v4-flash`, and should gbrain price these as Zen models or DeepSeek upstream equivalents?
- Should the provider id be `opencode` or `zen`? `opencode` is clearer for the API key (`OPENCODE_API_KEY`), while `zen` is shorter for model IDs.
- Should `deepseek-v4-flash-free` be included in the default model list, or omitted to avoid accidental private-data use?

## Suggested First PR Scope

Keep the first PR small:

- Add the `opencode` recipe.
- Register it.
- Add `OPENCODE_API_KEY` / `OPENCODE_BASE_URL` config plumbing.
- Add recipe and build-config tests.
- Add docs with the privacy caveat.

Defer budget-pricing cleanup and subagent-loop certification to follow-up PRs unless they are needed for the first use case.
