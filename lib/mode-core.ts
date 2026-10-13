import type {Mode} from './contracts';

// Workspace modes, pure part (owner: WS-08, plan §7). Client components import this file;
// lib/mode.ts re-exports it and adds currentMode(), which reads the database. The mode is
// stored per account (account_settings.mode), can be overridden per project (projects.mode) and is
// chosen at onboarding. A mode sets defaults, the order of sections and the wording. It never removes a
// feature: every mode lists every feature in FEATURES, and the "All features" page
// (/account/features) links to all of them in every mode.

export type {Mode};
export const MODES: readonly Mode[] = ['freelancer', 'agency', 'consumer', 'enterprise'];
export const isMode = (v: unknown): v is Mode => typeof v === 'string' && (MODES as readonly string[]).includes(v);

export const MODE_LABEL: Record<Mode, string> = {freelancer: 'Freelancer', agency: 'Agency', consumer: 'Consumer', enterprise: 'Enterprise'};
export const MODE_BLURB: Record<Mode, string> = {
  freelancer: 'You write the scope and your client approves it.',
  agency: 'Your team writes scopes; clients approve with a one-time code.',
  consumer: 'You are the buyer: write the brief or BOQ and send it to your vendor to accept.',
  enterprise: 'Roles, required identity checks, a retention policy and the audit export.',
};

/** Every feature, by id. The All features index renders all of them in every mode. */
export type FeatureId =
  | 'projects' | 'new_scope' | 'templates' | 'change_orders' | 'rate_card' | 'retainers' | 'invoices' | 'payments'
  | 'statement' | 'dispute_pack' | 'msmed_pack' | 'consumer_pack' | 'tds' | 'radar' | 'inbound' | 'insights'
  | 'otp' | 'cosign' | 'link_expiry' | 'verify' | 'retention' | 'legal_hold' | 'audit_export' | 'branding'
  | 'wording' | 'reminders' | 'business' | 'timezone' | 'mode' | 'onboarding' | 'plans' | 'api' | 'data_controls'
  | 'reviewer_guide' | 'privacy' | 'terms' | 'support';
export type Feature = {id: FeatureId; title: string; href: string; description: string; group: 'Scopes' | 'Money' | 'Evidence' | 'Compliance' | 'Account' | 'Help'};

export const FEATURES: readonly Feature[] = [
  {id: 'projects', title: 'Projects', href: '/', group: 'Scopes', description: 'Every scope and agreement in this workspace.'},
  {id: 'new_scope', title: 'New scope', href: '/?new=1', group: 'Scopes', description: 'Write a scope, or a brief/BOQ for a vendor.'},
  {id: 'templates', title: 'Templates', href: '/templates', group: 'Scopes', description: 'Saved, versioned and shared templates.'},
  {id: 'change_orders', title: 'Change orders', href: '/#change-orders', group: 'Scopes', description: 'Priced changes the client approves on the record.'},
  {id: 'rate_card', title: 'Rate card', href: '/#rate-card', group: 'Scopes', description: 'Standard prices for change orders.'},
  {id: 'retainers', title: 'Retainers', href: '/#retainers', group: 'Scopes', description: 'Recurring periods with usage.'},
  {id: 'radar', title: 'Scope-creep radar', href: '/#radar', group: 'Scopes', description: 'Check a client request against the agreement.'},
  {id: 'inbound', title: 'Email forwarding', href: '/#inbound', group: 'Scopes', description: 'Forward client emails into the radar.'},
  {id: 'invoices', title: 'Invoices', href: '/#invoices', group: 'Money', description: 'Numbered invoices and GST tax invoices.'},
  {id: 'payments', title: 'Payments', href: '/account#h-payments', group: 'Money', description: 'UPI, your own Razorpay or Stripe, stage payments.'},
  {id: 'statement', title: 'Statement of account', href: '/#statement', group: 'Money', description: 'Agreed total, every payment and the balance.'},
  {id: 'tds', title: 'TDS', href: '/#tds', group: 'Money', description: 'TDS deducted by business clients.'},
  {id: 'insights', title: 'Insights', href: '/?tab=insights', group: 'Money', description: 'Money recovered and patterns across agreements.'},
  {id: 'dispute_pack', title: 'Dispute pack', href: '/#dispute-pack', group: 'Evidence', description: 'Every receipt, the statement and the signed record.'},
  {id: 'msmed_pack', title: 'MSMED pack', href: '/#msmed', group: 'Evidence', description: 'Delayed-payment claim pack for Udyam micro and small units.'},
  {id: 'consumer_pack', title: 'Consumer evidence pack', href: '/#consumer-pack', group: 'Evidence', description: 'For a Consumer Protection Act / e-Daakhil complaint.'},
  {id: 'otp', title: 'One-time codes', href: '/#identity', group: 'Evidence', description: 'Confirm the client by email, SMS or WhatsApp code.'},
  {id: 'cosign', title: 'Countersign roles', href: '/#cosign', group: 'Evidence', description: 'Finance or a budget holder countersigns.'},
  {id: 'link_expiry', title: 'Review-link expiry', href: '/#link-expiry', group: 'Evidence', description: 'Pending links that expire.'},
  {id: 'verify', title: 'Verify a receipt', href: '/verify', group: 'Evidence', description: 'Check any receipt against the record.'},
  {id: 'retention', title: 'Retention', href: '/account#h-retention', group: 'Compliance', description: 'How long client IP and browser details are kept.'},
  {id: 'legal_hold', title: 'Legal hold', href: '/account#h-legal-hold', group: 'Compliance', description: 'Freeze a project: no redaction or deletion.'},
  {id: 'audit_export', title: 'Audit export', href: '/account#h-audit', group: 'Compliance', description: 'Signed JSONL/CSV of decisions, ledger and admin events.'},
  {id: 'data_controls', title: 'Data controls', href: '/account#h-data', group: 'Compliance', description: 'Export, revoke tokens and delete your data.'},
  {id: 'business', title: 'Business details', href: '/account#h-business', group: 'Account', description: 'GSTIN, Udyam, UPI and invoice details.'},
  {id: 'branding', title: 'Branding', href: '/account#h-brand', group: 'Account', description: 'Logo, colour and reply-to address.'},
  {id: 'wording', title: 'Your wording', href: '/account#h-wording', group: 'Account', description: 'Email wording and default clauses.'},
  {id: 'reminders', title: 'Automatic reminders', href: '/account#h-reminders', group: 'Account', description: 'Nudge clients who have not decided.'},
  {id: 'timezone', title: 'Time zone', href: '/account#h-timezone', group: 'Account', description: 'The zone new projects start in.'},
  {id: 'mode', title: 'Workspace mode', href: '/account#h-mode', group: 'Account', description: 'Freelancer, Agency, Consumer or Enterprise.'},
  {id: 'onboarding', title: 'Setup', href: '/onboarding', group: 'Account', description: 'Mode, country, currency and business details.'},
  {id: 'plans', title: 'Plans and billing', href: '/plans', group: 'Account', description: 'Your plan, upgrade and ScopeFlow invoices.'},
  {id: 'api', title: 'API and connectors', href: '/connect', group: 'Account', description: 'API tokens, MCP and the ChatGPT connector.'},
  {id: 'reviewer_guide', title: 'Reviewer guide', href: '/reviewer-guide', group: 'Help', description: 'What your client sees.'},
  {id: 'privacy', title: 'Privacy', href: '/privacy', group: 'Help', description: 'What ScopeFlow records and for how long.'},
  {id: 'terms', title: 'Terms', href: '/terms', group: 'Help', description: 'The terms of service.'},
  {id: 'support', title: 'Support', href: '/support', group: 'Help', description: 'Corrections and help.'},
];

export type IdentityDefault = 'optional' | 'default_on' | 'required';
export type ModeDefaults = {
  mode: Mode;
  /** Compliance features (retention policy, audit export, countersign roles) on by default. */
  compliance: boolean;
  /** Who writes the scope: the seller, or the buyer (Consumer mode sends a brief/BOQ to a vendor). */
  author: 'seller' | 'buyer';
  /** One-time code for the other party: optional, on by default for new projects, or required. */
  otp: IdentityDefault;
  /** Countersign roles on by default (Enterprise: budget-holder countersign on change orders). */
  countersign_roles: boolean;
  /** A retention period must be set (30–3650 days) and cannot be "server default". */
  retention_required: boolean;
  /** Allowed range for the account retention period, in days. */
  retention_range: readonly [number, number];
  /** The signed audit export is part of this mode's toolkit (it stays reachable in every mode). */
  audit_export: boolean;
  /** GST invoicing by this account (Consumer: records vendor invoices instead). */
  gst_invoicing: 'if_gstin' | 'off' | 'mandatory_if_gstin';
  msmed: boolean;
  tds: boolean;
  /** Payment rails shown first, in order. */
  payments_first: readonly string[];
  /** Change-order wording and rules. */
  change_orders: {word: 'change order' | 'variation'; photos_required: boolean; countersign: boolean};
  /** Template categories shown first. */
  templates_first: readonly string[];
  /** Seats expected for the workspace. */
  seats: string;
  /** Contact lock strictness after the first send. */
  contact_lock: 'standard' | 'strict';
  /** Data-residency note shown in Account (Enterprise). */
  data_residency_note: string | null;
  /** The order the All features index and the Account page present features in; every feature appears exactly once. */
  order: readonly FeatureId[];
  /** Mode-specific wording: what the other party is called, and the scope document's name. */
  copy: {party: string; document: string; send: string};
};

const ALL = FEATURES.map(f => f.id);
/** `first` in that order, then every remaining feature in the default order: nothing is ever dropped. */
const ordered = (first: FeatureId[]): FeatureId[] => [...first, ...ALL.filter(id => !first.includes(id))];

const BASE: Omit<ModeDefaults, 'mode'> = {
  compliance: false, author: 'seller', otp: 'optional', countersign_roles: false, retention_required: false,
  retention_range: [1, 3650], audit_export: false, gst_invoicing: 'if_gstin', msmed: true, tds: true,
  payments_first: ['upi', 'razorpay', 'stripe'], change_orders: {word: 'change order', photos_required: false, countersign: false},
  templates_first: ['design', 'development', 'marketing'], seats: '1', contact_lock: 'standard', data_residency_note: null,
  order: ALL, copy: {party: 'client', document: 'scope', send: 'Send for signature'},
};

export const DATA_RESIDENCY_NOTE = 'Records are stored in the ScopeFlow database region chosen by the operator (see the privacy page). ScopeFlow does not yet offer a per-account data region; ask support before relying on a specific location.';

/** Defaults a mode sets (plan §7). Pure. */
export function modeDefaults(mode: Mode): ModeDefaults {
  switch (mode) {
    case 'agency': return {...BASE, mode, otp: 'default_on', payments_first: ['upi', 'razorpay', 'stripe', 'team_payout_notes'], templates_first: ['agency_retainer', 'design', 'development'], seats: '3+ (owner, manager, member, finance)',
      order: ordered(['projects', 'new_scope', 'templates', 'retainers', 'rate_card', 'change_orders', 'invoices', 'payments', 'insights'])};
    case 'consumer': return {...BASE, mode, author: 'buyer', otp: 'default_on', gst_invoicing: 'off', msmed: false, tds: false,
      payments_first: ['stage_payments', 'upi', 'bank_transfer', 'escrow'], change_orders: {word: 'variation', photos_required: true, countersign: false},
      templates_first: ['renovation_boq', 'wedding_vendor', 'event_vendor'], seats: '1–2 (household)',
      order: ordered(['projects', 'new_scope', 'templates', 'payments', 'change_orders', 'consumer_pack', 'statement', 'verify']),
      copy: {party: 'vendor', document: 'brief', send: 'Send to your vendor'}};
    case 'enterprise': return {...BASE, mode, compliance: true, otp: 'required', countersign_roles: true, retention_required: true, retention_range: [30, 3650], audit_export: true,
      gst_invoicing: 'mandatory_if_gstin', payments_first: ['razorpay', 'stripe', 'upi'], change_orders: {word: 'change order', photos_required: false, countersign: true},
      templates_first: ['msa_sow', 'ca_engagement', 'legal_engagement'], seats: 'Roles (SSO-ready)', contact_lock: 'strict', data_residency_note: DATA_RESIDENCY_NOTE,
      order: ordered(['projects', 'new_scope', 'audit_export', 'retention', 'legal_hold', 'cosign', 'otp', 'templates', 'invoices', 'tds'])};
    default: return {...BASE, mode: 'freelancer'};
  }
}

/** Features in the mode's order: always all of FEATURES, each once. */
export function featuresFor(mode: Mode): Feature[] {
  const byId = new Map(FEATURES.map(f => [f.id, f]));
  return modeDefaults(mode).order.map(id => byId.get(id)!);
}
