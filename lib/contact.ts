import {sha256} from './ledger';

// C5: signed contact_history records (owner: WS-02). Pure.

/** The signed form of one contact change (key order fixed). */
export async function contactMessage(r: {project_id: string; field: string; from_masked: string | null; to_masked: string | null; reason: string; at: string}) {
  return 'scopeflow-contact-v1:' + await sha256(JSON.stringify({project_id: r.project_id, field: r.field, from_masked: r.from_masked, to_masked: r.to_masked, reason: r.reason, at: r.at}));
}

