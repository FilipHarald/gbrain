/**
 * OpenCode Zen recipe smoke + shape regression.
 *
 * Zen exposes several wire protocols. This recipe intentionally covers the
 * OpenAI-compatible /chat/completions subset only; other Zen models route via
 * /responses, /messages, or provider-native endpoints and need separate
 * gateway implementations.
 */

import { describe, expect, test } from 'bun:test';
import { getRecipe } from '../../src/core/ai/recipes/index.ts';
import { defaultResolveAuth } from '../../src/core/ai/gateway.ts';
import { assertTouchpoint } from '../../src/core/ai/model-resolver.ts';
import { AIConfigError } from '../../src/core/ai/errors.ts';

const MODEL_SHAPE = /^[a-z0-9][a-z0-9._-]*$/i;

describe('recipe: opencode', () => {
  test('registered with expected OpenAI-compatible shape', () => {
    const r = getRecipe('opencode');
    expect(r).toBeDefined();
    expect(r!.id).toBe('opencode');
    expect(r!.name).toBe('OpenCode Zen');
    expect(r!.tier).toBe('openai-compat');
    expect(r!.implementation).toBe('openai-compatible');
    expect(r!.base_url_default).toBe('https://opencode.ai/zen/v1');
    expect(r!.auth_env?.required).toEqual(['OPENCODE_API_KEY']);
    expect(r!.auth_env?.optional).toContain('OPENCODE_BASE_URL');
  });

  test('chat touchpoint lists Zen /chat/completions entry points', () => {
    const r = getRecipe('opencode')!;
    const chat = r.touchpoints.chat;
    expect(chat).toBeDefined();
    expect(chat!.supports_tools).toBe(true);
    expect(chat!.supports_subagent_loop).toBe(true);
    expect(chat!.supports_prompt_cache).toBe(false);
    expect(chat!.models).toContain('deepseek-v4-pro');
    expect(chat!.models).toContain('deepseek-v4-flash');
    expect(chat!.models).toContain('minimax-m2.7');
    expect(chat!.models).toContain('glm-5.1');
    expect(chat!.models).toContain('kimi-k2.6');
    expect(chat!.models).toContain('deepseek-v4-flash-free');
    for (const model of chat!.models) {
      expect(model, `Zen chat model "${model}" should be a bare Zen model id`).toMatch(MODEL_SHAPE);
    }
  });

  test('openai-compat tier accepts arbitrary future Zen chat-completions model ids', () => {
    const r = getRecipe('opencode')!;
    expect(() => assertTouchpoint(r, 'chat', 'future-zen-model-2030')).not.toThrow();
    expect(() => assertTouchpoint(r, 'chat', 'custom.team-model_v2')).not.toThrow();
  });

  test('defaultResolveAuth with OPENCODE_API_KEY returns Bearer header', () => {
    const r = getRecipe('opencode')!;
    const auth = defaultResolveAuth(
      r,
      { OPENCODE_API_KEY: 'sk-opencode-fake' },
      'chat',
    );
    expect(auth.headerName).toBe('Authorization');
    expect(auth.token).toBe('Bearer sk-opencode-fake');
  });

  test('missing OPENCODE_API_KEY throws AIConfigError', () => {
    const r = getRecipe('opencode')!;
    expect(() => defaultResolveAuth(r, {}, 'chat')).toThrow(AIConfigError);
  });

  test('setup_hint references required + optional env vars and arbitrary model use', () => {
    const r = getRecipe('opencode')!;
    expect(r.setup_hint).toContain('OPENCODE_API_KEY');
    expect(r.setup_hint).toContain('opencode:deepseek-v4-flash');
    expect(r.setup_hint).toContain('chat/completions model');
  });
});
