'use client';

import {useMemo, useState} from 'react';
import {toast} from 'sonner';
import {
  CheckCircle2,
  Copy,
  Eye,
  Fingerprint,
  Lock,
  MessageCircle,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Paper} from '../ui';
import {formatMoney, itemsOf, type Scope} from '@/lib/scope';
import {computable, totals} from '@/lib/money';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  version?: number;
};

async function sha256Hex(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function ClientPreviewBody({scope, version}: {scope: Scope; version: number}) {
  const [reviewerName, setReviewerName] = useState(scope.client || '');
  const [consent, setConsent] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  const [decision, setDecision] = useState<
    | null
    | {kind: 'approved'; by: string; at: string; fingerprint: string}
    | {kind: 'changes_requested'; by: string; at: string; note: string}
  >(null);
  const [busy, setBusy] = useState(false);

  const safeScope = useMemo(() => computable(scope), [scope]);
  const moneyTotals = useMemo(() => totals(safeScope), [safeScope]);

  const whatsappSummary = useMemo(() => {
    const items = itemsOf(safeScope).slice(0, 4);
    const lines = [
      `Hi ${safeScope.client || 'there'}, quick recap of "${safeScope.title || 'our agreement'}" so we’re both aligned:`,
      `• Agreed total: ${formatMoney(moneyTotals.total, safeScope.currency)}${moneyTotals.tax_pct > 0 ? ` (incl. ${moneyTotals.tax_label} ${moneyTotals.tax_pct}%)` : ''}`,
      ...items.map(i => `• ${i.title}${i.acceptance ? ` (${i.acceptance})` : ''}`),
      safeScope.exclusions
        ? `• Outside scope: ${safeScope.exclusions.slice(0, 140)}${safeScope.exclusions.length > 140 ? '…' : ''}`
        : '',
      safeScope.payment_terms ? `• Payment terms: ${safeScope.payment_terms}` : '',
      `Please reply "Confirmed" if this looks right!`,
    ].filter(Boolean);
    return lines.join('\n');
  }, [safeScope, moneyTotals]);

  async function simulateApprove() {
    const name = reviewerName.trim();
    if (name.length < 2) {
      toast.error('Enter a reviewer name (at least 2 characters) to test approval.');
      return;
    }
    if (!consent) {
      toast.error('Check the confirmation box first.');
      return;
    }
    setBusy(true);
    try {
      const at = new Date().toISOString();
      const fingerprint = await sha256Hex(JSON.stringify({scope: safeScope, version, approved_by: name, at}));
      setDecision({kind: 'approved', by: name, at, fingerprint});
      toast.success('Simulated client approval recorded with SHA-256 fingerprint.');
    } finally {
      setBusy(false);
    }
  }

  function simulateRequestChanges() {
    const name = reviewerName.trim() || safeScope.client || 'Reviewer';
    const note = changeNote.trim() || 'Please clarify the delivery date and add an itemized bill clause.';
    setDecision({kind: 'changes_requested', by: name, at: new Date().toISOString(), note});
    toast('Simulated change request recorded.');
  }

  async function copyWhatsApp() {
    try {
      await navigator.clipboard.writeText(whatsappSummary);
      toast.success('WhatsApp soft-confirm recap copied.');
    } catch {
      toast.error('Could not copy message.');
    }
  }

  return (
    <Tabs defaultValue="review" className="preview-modal-tabs">
      <TabsList variant="line">
        <TabsTrigger value="review">1-Tap review link</TabsTrigger>
        <TabsTrigger value="whatsapp">WhatsApp soft confirm</TabsTrigger>
      </TabsList>

      <TabsContent value="review" className="preview-modal-body">
        <div className="preview-sim-banner">
          <Lock size={14} aria-hidden="true" />
          <span>Interactive preview · Version {version} · No login required for counterparty</span>
        </div>

        <div className="preview-paper-wrap">
          <Paper
            scope={safeScope}
            version={version}
            status={decision?.kind ?? 'pending'}
          />
        </div>

        {decision?.kind === 'approved' ? (
          <div className="preview-decision-box is-approved" role="status">
            <div className="preview-decision-head">
              <CheckCircle2 size={20} aria-hidden="true" />
              <strong>Approved by {decision.by}</strong>
            </div>
            <p className="fine flush">
              Recorded at {new Date(decision.at).toLocaleString()} · Interactive demo receipt
            </p>
            <p className="fine mono flush preview-hash">
              <Fingerprint size={14} aria-hidden="true" /> SHA-256: {decision.fingerprint.slice(0, 32)}…
            </p>
            <div className="actions gap-top">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setDecision(null);
                  setConsent(false);
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                Reset simulation
              </button>
            </div>
          </div>
        ) : decision?.kind === 'changes_requested' ? (
          <div className="preview-decision-box is-changes" role="status">
            <strong>Changes requested by {decision.by}</strong>
            <p className="quote">{decision.note}</p>
            <div className="actions gap-top">
              <button type="button" className="secondary" onClick={() => setDecision(null)}>
                <RotateCcw size={14} aria-hidden="true" />
                Reset simulation
              </button>
            </div>
          </div>
        ) : (
          <div className="preview-sign-box">
            <p className="eyebrow flush">Test the counterparty decision</p>
            <div className="two-col">
              <label>
                Counterparty full name
                <input
                  value={reviewerName}
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder={safeScope.client || 'Name of person approving'}
                />
              </label>
              <label>
                Optional change request note
                <input
                  value={changeNote}
                  onChange={e => setChangeNote(e.target.value)}
                  placeholder="Only needed if requesting changes"
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
              />
              I have read this version-locked summary and agree to the deliverables, exclusions, and payment terms.
            </label>
            <div className="actions gap-top">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void simulateApprove()}
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                Approve agreement
              </button>
              <button type="button" className="secondary" onClick={simulateRequestChanges}>
                Request changes
              </button>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="whatsapp" className="preview-modal-body">
        <p className="quiet">
          If a landlord, caterer, or busy client won’t open a web link, paste this 5-line recap into WhatsApp or
          SMS. A simple “Confirmed” reply + your bank UTR builds an admissible written trail.
        </p>
        <pre className="ladder-pre">{whatsappSummary}</pre>
        <div className="actions gap-top">
          <button type="button" className="primary" onClick={() => void copyWhatsApp()}>
            <Copy size={15} aria-hidden="true" />
            Copy WhatsApp message
          </button>
          <a
            className="secondary"
            href={'https://wa.me/?text=' + encodeURIComponent(whatsappSummary)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={15} aria-hidden="true" />
            Open in WhatsApp
          </a>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export default function ClientPreviewModal({open, onOpenChange, scope, version = 1}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="client-preview-dialog">
        <DialogTitle className="preview-modal-title">
          <Eye size={18} aria-hidden="true" />
          What the other side receives
        </DialogTitle>
        <DialogDescription>
          Preview the zero-signup review link your client, landlord, or vendor opens — or send a 5-line WhatsApp soft
          confirm if they prefer messaging over links.
        </DialogDescription>
        {open && (
          <ClientPreviewBody
            key={`${scope.client}|${scope.title}|${version}`}
            scope={scope}
            version={version}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
