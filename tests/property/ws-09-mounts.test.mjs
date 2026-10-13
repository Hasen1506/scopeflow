// WS-09 part D pure checks: every cross-workstream slot the workspace owns is mounted in the split
// workspace modules (plan §5.3, one-line JSX mounts), and the H4 revoke/replace dialog copy tells the owner
// that a decided version's client keeps a read-only copy while a pending version's link dies.
// Reads source files only; no browser, no network.
// @covers H4
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import './../support/ts-resolve.mjs';

const {linkDialogCopy, decidedStatus, revokedNote} = await import('../../lib/review-link-copy.ts');
const src = f => readFileSync(new URL('../../app/workspace/' + f, import.meta.url), 'utf8');

// Where each slot lives (plan §5.3). RateCardPicker / RetainerCounter (WS-05) are mounted by WS-05 inside
// ledger-panel, TdsField (invoice) / MsmedTerms by WS-03 inside invoice-panel, both of which the workspace
// mounts; mounting them again here would render them twice once those workstreams land.
const MOUNTS = [
  ['editor.tsx', 'tds-field', 'TdsField'],
  ['settings.tsx', 'contact-change', 'ContactChange'],
  ['settings.tsx', 'cosigner-editor', 'CosignerEditor'],
  ['approval.tsx', 'whatsapp-share', 'WhatsAppShare'],
];

test('every workspace slot is imported from app/components/slots and rendered as JSX', () => {
  for (const [file, slot, name] of MOUNTS) {
    const s = src(file);
    assert.match(s, new RegExp(`import ${name} from '\\.\\./components/slots/${slot}'`), `${file} imports ${slot}`);
    assert.match(s, new RegExp(`<${name}[\\s/>]`), `${file} renders <${name}>`);
  }
  // invoice panel (WS-03) and ledger panel (WS-05) stay mounted; WS-06 notices in both lists and settings.
  assert.match(src('money.tsx'), /<InvoicePanel /);
  assert.match(src('changes.tsx'), /<LedgerPanel /);
  assert.match(src('changes.tsx'), /<ClientNotices [^>]*list="change_orders"/);
  assert.match(src('money.tsx'), /<ClientNotices [^>]*list="invoices"/);
  assert.match(src('settings.tsx'), /<NotifyToggle /);
  // the theme switcher sits in the header.
  assert.match(readFileSync(new URL('../../app/ui.tsx', import.meta.url), 'utf8'), /ThemeSwitcher/);
});

test('mounts are behaviour-neutral on a base without WS-06: no ClientNotice export, no request', async () => {
  const slot = readFileSync(new URL('../../app/components/slots/whatsapp-share.tsx', import.meta.url), 'utf8');
  const notices = src('client-notices.tsx');
  assert.match(notices, /if \(!clientNoticesLive\) return;/);
  if (!/export function ClientNotice/.test(slot)) assert.match(slot, /return null;/);
});

test('H4: decided versions keep the client copy; pending links die', () => {
  assert.equal(decidedStatus('pending'), false);
  assert.equal(decidedStatus('approved'), true);
  assert.equal(decidedStatus('declined'), true);
  assert.equal(decidedStatus(undefined), false);
  for (const action of ['revoke', 'rotate']) {
    const d = linkDialogCopy(action, true), p = linkDialogCopy(action, false);
    assert.match(d.body, /keeps their copy/);
    assert.match(d.body, /read-only/);
    assert.doesNotMatch(p.body, /keeps their copy/);
    assert.match(p.body, /stops working immediately/);
    // the dialog title never changes while it closes (golden-flow regression), and revoke never says Replace
    assert.equal(d.title, p.title);
    assert.equal(d.confirm, p.confirm);
  }
  assert.equal(linkDialogCopy('revoke', true).title, 'Revoke review access?');
  assert.doesNotMatch(JSON.stringify(linkDialogCopy('revoke', true)) + JSON.stringify(linkDialogCopy('revoke', false)), /Replace/);
  assert.match(revokedNote(true), /read-only copy/);
  assert.equal(revokedNote(false), 'This version’s review link is revoked.');
});

test('H4: the workspace dialog and notice use the shared copy', () => {
  assert.match(src('shell.tsx'), /linkDialogCopy\(shownLink,decidedStatus\(active\?\.status\)\)/);
  assert.match(src('state.tsx'), /linkDialogCopy\(linkAction,decidedStatus\(active\.status\)\)\.done/);
  assert.doesNotMatch(src('shell.tsx'), /The current link will stop working immediately/);
});
