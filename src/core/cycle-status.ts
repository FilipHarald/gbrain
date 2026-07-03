import type { BrainEngine, SourceRow } from './engine.ts';
import type { CycleReport } from './cycle.ts';

const SUCCESSFUL_CYCLE_STATUSES = new Set(['ok', 'clean', 'partial']);

export interface CycleCompletionRecord {
  finished_at: string;
  source_id: string;
}

export async function recordCycleCompletion(
  engine: BrainEngine,
  sourceId: string,
  report: Pick<CycleReport, 'status'>,
  finishedAt = new Date(),
): Promise<boolean> {
  if (!SUCCESSFUL_CYCLE_STATUSES.has(report.status)) return false;

  const finishedAtIso = finishedAt.toISOString();
  return engine.updateSourceConfig(sourceId, {
    last_source_cycle_at: finishedAtIso,
    last_full_cycle_at: finishedAtIso,
  });
}

export async function readLatestCycleCompletion(
  engine: Pick<BrainEngine, 'listAllSources'>,
): Promise<CycleCompletionRecord | null> {
  let sources: SourceRow[];
  try {
    sources = await engine.listAllSources({ includeArchived: false });
  } catch {
    return null;
  }

  let latest: CycleCompletionRecord | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const source of sources) {
    const raw = source.config?.last_full_cycle_at;
    if (typeof raw !== 'string') continue;
    const ms = new Date(raw).getTime();
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = { finished_at: new Date(ms).toISOString(), source_id: source.id };
  }

  return latest;
}
