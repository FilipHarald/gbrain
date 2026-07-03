/**
 * v0.38 — runCycle exit hook writes last_full_cycle_at on per-source
 * cycles. Closes codex round-1 P0-5 (write site for last_full_cycle_at
 * was unspecified pre-PR).
 *
 * Conditions for write:
 *   - sourceId is explicit or resolvable from brainDir
 *   - engine is non-null (no-DB path skips)
 *   - status is 'ok' | 'clean' | 'partial' (failed/skipped don't mark fresh)
 *   - dryRun is false
 *
 * Best-effort: a write failure does NOT change the CycleReport status.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { withEnv } from './helpers/with-env.ts';
import { runCycle } from '../src/core/cycle.ts';
import { buildCycleSnapshot } from '../src/commands/status.ts';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let engine: PGLiteEngine;
let brainDir: string;
// Per-test GBRAIN_HOME isolation: cycle's PGLite path acquires a file
// lock at `~/.gbrain/cycle.lock` (no sourceId scope). Without isolating
// GBRAIN_HOME per test, parallel gbrain processes on the same machine
// (including sibling Conductor worktrees running their own tests)
// contend for the same lock file — runCycle returns 'skipped' and the
// last_full_cycle_at exit hook silently no-ops. Each test wraps its
// body in `withEnv({GBRAIN_HOME: <unique tmp>})` so the file lock path
// becomes per-test.
let gbrainHome: string;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await resetPgliteState(engine);
  brainDir = mkdtempSync(join(tmpdir(), 'gbrain-cycle-lfca-'));
  gbrainHome = mkdtempSync(join(tmpdir(), 'gbrain-cycle-lfca-home-'));
});

async function seedSource(id: string): Promise<void> {
  await engine.executeRaw(
    `INSERT INTO sources (id, name, local_path, config, archived, created_at)
     VALUES ($1, $2, $3, '{}'::jsonb, false, NOW())
     ON CONFLICT (id) DO UPDATE SET local_path = EXCLUDED.local_path`,
    [id, id, brainDir],
  );
}

async function readLastFullCycleAt(sourceId: string): Promise<string | null> {
  const sources = await engine.listAllSources();
  const s = sources.find(x => x.id === sourceId);
  if (!s) return null;
  const raw = s.config?.last_full_cycle_at;
  return typeof raw === 'string' ? raw : null;
}

describe('runCycle last_full_cycle_at exit hook', () => {
  test('per-source cycle with status=ok writes timestamp', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('alpha');
      const before = await readLastFullCycleAt('alpha');
      expect(before).toBeNull();

      // Run a minimal cycle: just lint (filesystem, no DB writes, always returns 'ok')
      const t0 = Date.now();
      const report = await runCycle(engine, {
        brainDir,
        sourceId: 'alpha',
        phases: ['lint'],
      });
      // lint on an empty dir returns ok+clean+0 fixes
      expect(['ok', 'clean']).toContain(report.status);

      const after = await readLastFullCycleAt('alpha');
      expect(after).not.toBeNull();
      const writtenMs = new Date(after!).getTime();
      expect(writtenMs).toBeGreaterThanOrEqual(t0);
      expect(writtenMs).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  test('caller without sourceId writes timestamp when brainDir resolves to a source', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('default-like');
      const report = await runCycle(engine, {
        brainDir,
        phases: ['lint'],
      });
      expect(['ok', 'clean']).toContain(report.status);

      const after = await readLastFullCycleAt('default-like');
      expect(after).not.toBeNull();
    });
  });

  test('status last_full reads direct runCycle completion without a minion job row', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('status-source');
      await runCycle(engine, { brainDir, phases: ['lint'] });

      const jobs = await engine.executeRaw<{ n: number }>(
        `SELECT count(*)::int AS n FROM minion_jobs WHERE name = 'autopilot-cycle' AND status = 'completed'`,
      );
      expect(jobs[0]?.n ?? 0).toBe(0);

      const snapshot = await buildCycleSnapshot(engine);
      expect(snapshot.last_full?.name).toBe('runCycle');
      expect(snapshot.last_full?.status).toBe('completed');
      expect(snapshot.last_full?.finished_at).toBe(await readLastFullCycleAt('status-source'));
    });
  });

  test('dryRun=true skips the write', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('beta');
      await runCycle(engine, {
        brainDir,
        sourceId: 'beta',
        phases: ['lint'],
        dryRun: true,
      });
      const after = await readLastFullCycleAt('beta');
      expect(after).toBeNull();
    });
  });

  test('cycle that returns skipped (lock held) does NOT mark timestamp', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('gamma');
      // Inject a live lock row directly so the cycle returns 'skipped'.
      // This simulates "another cycle is already running for gamma."
      const lockId = 'gbrain-cycle:gamma';
      const pid = process.pid;
      await engine.executeRaw(
        `INSERT INTO gbrain_cycle_locks (id, holder_pid, holder_host, acquired_at, ttl_expires_at)
         VALUES ($1, $2, 'test', NOW(), NOW() + INTERVAL '30 minutes')`,
        [lockId, pid + 99999],
      );
      const report = await runCycle(engine, {
        brainDir,
        sourceId: 'gamma',
        phases: ['lint', 'sync'], // sync triggers lock acquisition
      });
      expect(report.status).toBe('skipped');
      expect(report.reason).toBe('cycle_already_running');
      const after = await readLastFullCycleAt('gamma');
      expect(after).toBeNull();
    });
  });

  test('two consecutive per-source cycles update the timestamp on each run', async () => {
    await withEnv({ GBRAIN_HOME: gbrainHome }, async () => {
      await seedSource('delta');
      await runCycle(engine, { brainDir, sourceId: 'delta', phases: ['lint'] });
      const first = await readLastFullCycleAt('delta');
      expect(first).not.toBeNull();
      // Wait 10ms so the timestamp can advance
      await new Promise(r => setTimeout(r, 10));
      await runCycle(engine, { brainDir, sourceId: 'delta', phases: ['lint'] });
      const second = await readLastFullCycleAt('delta');
      expect(second).not.toBeNull();
      expect(new Date(second!).getTime()).toBeGreaterThan(new Date(first!).getTime());
    });
  });
});
