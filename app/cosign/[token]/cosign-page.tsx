'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header, api} from '@/app/ui';
import {Paper} from '@/app/paper';
import type {Scope} from '@/lib/scope';
import {formatInZone} from '@/lib/time';
import {CosignForm} from '@/app/review/[token]/countersign';
import {RecordEvidence, type Evidence} from '@/app/components/evidence/record-evidence';

type Data = {
  role: {id: string; role: string; name: string | null};
  scope: {project_id: string; version: number; latest: number; content: Scope; status: string; signer: string | null; decided: string | null};
  cosign: null | {signer: string; signed: string; signature: string | null; verified_to: string | null};
  identity_check: null | {method: string; channel: 'email' | 'sms' | 'whatsapp'; to: string};
  readonly: boolean; evidence: Evidence | null; time_zone: string;
};

/** H1: a countersigning role's own page: the approved record, its evidence, and this role's signature. */
export function CosignPage({token}: {token: string}) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState('');
  const load = useCallback(async () => { setData(await api('/api/cosign/' + token)); }, [token]);
  useEffect(() => { let live = true; api('/api/cosign/' + token).then(d => { if (live) setData(d); }, e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [token]);
  const tz = data?.time_zone ?? 'UTC';
  return <><Header /><main id="content" tabIndex={-1} className="review-shell">
    <h1 className={data ? 'sr-only' : undefined}>{error ? 'This countersign link is not available' : 'Countersign'}</h1>
    {error && <div className="error" role="alert">{error}</div>}
    {data && <>
      <p className="eyebrow">COUNTERSIGN · {data.role.role.toUpperCase()} · VERSION {data.scope.version}</p>
      <Paper scope={data.scope.content} version={data.scope.version} status={data.scope.status} />
      {data.evidence && <RecordEvidence evidence={data.evidence} formatTime={iso => formatInZone(iso, tz)} />}
      {data.cosign
        ? <section className="editor" aria-live="polite"><h2>Countersigned</h2><p className="chain ok" role="status" data-testid="cosign-done">{data.role.role}: countersigned by {data.cosign.signer}{data.cosign.verified_to ? ` (code verified to ${data.cosign.verified_to})` : ''} · {formatInZone(data.cosign.signed, tz)}</p></section>
        : data.readonly || data.scope.status !== 'approved' || data.scope.version !== data.scope.latest
          ? <section className="editor"><p className="quiet">This version can no longer be countersigned.</p></section>
          : <CosignForm token={token} content={data.scope.content} version={data.scope.version} role={data.role} timeZone={tz} identity={data.identity_check} onSigned={() => { void load(); }} />}
    </>}
  </main></>;
}
