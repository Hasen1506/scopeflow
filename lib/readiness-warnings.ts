import {db} from './server';
import {setModelWarningSink} from './llm';

// Readiness warnings (WS-06 writes, WS-10's /api/readiness reads scopeflow.readiness_warnings).
// Importing this module registers the model-fallback sink (L11), so a model that answered 404 and
// was replaced by its fallback shows up in readiness until the operator fixes SCOPEFLOW_MODELS.

export async function recordReadinessWarning(key: string, source: string, message: string) {
  await db().prepare('INSERT INTO scopeflow.readiness_warnings (key,source,message,at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET message=excluded.message, at=excluded.at')
    .bind(key.slice(0, 200), source.slice(0, 40), message.slice(0, 1000), new Date().toISOString()).run();
}
export async function readinessWarnings(): Promise<{key: string; source: string; message: string; at: string}[]> {
  return (await db().prepare('SELECT key,source,message,at FROM scopeflow.readiness_warnings ORDER BY at DESC LIMIT 50').all<{key: string; source: string; message: string; at: string}>()).results;
}
setModelWarningSink(w => recordReadinessWarning(w.key, 'ai', w.message));
