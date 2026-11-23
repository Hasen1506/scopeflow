import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  phone: text('phone'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventCollections = pgTable('event_collections', {
  id: text('id').primaryKey(),
  ownerUid: text('owner_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('marriage'),
  title: text('title').notNull(),
  jurisdiction: text('jurisdiction').notNull().default('IN-KA'),
  currency: text('currency').notNull().default('INR'),
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  city: text('city').default(''),
  primaryContactName: text('primary_contact_name').default(''),
  primaryContactPhone: text('primary_contact_phone').default(''),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subEvents = pgTable('sub_events', {
  id: text('id').primaryKey(),
  collectionId: text('collection_id')
    .notNull()
    .references(() => eventCollections.id, { onDelete: 'cascade' }),
  ownerUid: text('owner_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  title: text('title').notNull(),
  eventDate: text('event_date').default(''),
  timeSlot: text('time_slot').default(''),
  venueName: text('venue_name').default(''),
  venueAddress: text('venue_address').default(''),
  guestCount: integer('guest_count').notNull().default(0),
  coordinatorName: text('coordinator_name').default(''),
  coordinatorPhone: text('coordinator_phone').default(''),
  status: text('status').notNull().default('planning'),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventVendors = pgTable('event_vendors', {
  id: text('id').primaryKey(),
  collectionId: text('collection_id')
    .notNull()
    .references(() => eventCollections.id, { onDelete: 'cascade' }),
  subEventId: text('sub_event_id').references(() => subEvents.id, { onDelete: 'set null' }),
  ownerUid: text('owner_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  category: text('category').notNull().default('catering'),
  vendorName: text('vendor_name').notNull(),
  contactPerson: text('contact_person').default(''),
  contactPhone: text('contact_phone').default(''),
  contactEmail: text('contact_email').default(''),
  whatsappNumber: text('whatsapp_number').default(''),
  agreedFee: integer('agreed_fee').notNull().default(0),
  advancePaid: integer('advance_paid').notNull().default(0),
  paymentDueDate: text('payment_due_date').default(''),
  utrReference: text('utr_reference').default(''),
  agreementStatus: text('agreement_status').notNull().default('draft'),
  clauseSummary: text('clause_summary').default(''),
  deliverables: text('deliverables').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const advisorMessages = pgTable('advisor_messages', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid')
    .notNull()
    .references(() => users.uid, { onDelete: 'cascade' }),
  collectionId: text('collection_id'),
  persona: text('persona').notNull().default('wedding-planner'),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model').default('gemini-4-hydrogen'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  collections: many(eventCollections),
  advisorMessages: many(advisorMessages),
}));

export const eventCollectionsRelations = relations(eventCollections, ({ one, many }) => ({
  owner: one(users, {
    fields: [eventCollections.ownerUid],
    references: [users.uid],
  }),
  subEvents: many(subEvents),
  vendors: many(eventVendors),
}));

export const subEventsRelations = relations(subEvents, ({ one, many }) => ({
  collection: one(eventCollections, {
    fields: [subEvents.collectionId],
    references: [eventCollections.id],
  }),
  vendors: many(eventVendors),
}));

export const eventVendorsRelations = relations(eventVendors, ({ one }) => ({
  collection: one(eventCollections, {
    fields: [eventVendors.collectionId],
    references: [eventCollections.id],
  }),
  subEvent: one(subEvents, {
    fields: [eventVendors.subEventId],
    references: [subEvents.id],
  }),
}));

export const advisorMessagesRelations = relations(advisorMessages, ({ one }) => ({
  owner: one(users, {
    fields: [advisorMessages.ownerUid],
    references: [users.uid],
  }),
}));

// ---- Core TermsLock workspace, account settings, business profiles & templates ----
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    latest: integer('latest').notNull(),
    created: text('created').notNull(),
    archived: text('archived'),
    clientEmail: text('client_email'),
    requireOtp: boolean('require_otp').notNull().default(false),
    timezone: text('timezone'),
    lastSent: text('last_sent'),
    sentVersion: integer('sent_version'),
    reminders: integer('reminders').notNull().default(0),
    linkExpiryDays: integer('link_expiry_days'),
    linkIssued: text('link_issued'),
    clientPhone: text('client_phone'),
    otpChannel: text('otp_channel').notNull().default('email'),
    cosigners: text('cosigners'),
    clientGstin: text('client_gstin'),
    clientState: text('client_state'),
    clientAddress: text('client_address'),
    retentionDays: integer('retention_days'),
    legalHold: boolean('legal_hold').notNull().default(false),
    legalHoldReason: text('legal_hold_reason'),
    legalHoldSet: text('legal_hold_set'),
    inboundToken: text('inbound_token'),
    contactSince: text('contact_since'),
    ownerDeleted: text('owner_deleted'),
    retainUntil: text('retain_until'),
    notifyClient: boolean('notify_client').notNull().default(true),
    mode: text('mode'),
  },
  (t) => [index('idx_projects_owner').on(t.owner)],
);

export const versions = pgTable(
  'versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    token: text('token').notNull(),
    revoked: integer('revoked').notNull().default(0),
    content: text('content').notNull(),
    status: text('status').notNull().default('pending'),
    signer: text('signer'),
    comment: text('comment'),
    created: text('created').notNull(),
    decided: text('decided'),
    signature: text('signature'),
    decisionContext: text('decision_context'),
  },
  (t) => [
    uniqueIndex('idx_versions_project_version').on(t.projectId, t.version),
    uniqueIndex('idx_versions_token').on(t.token),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    hash: text('hash').primaryKey(),
    owner: text('owner').notNull(),
    expires: text('expires').notNull(),
    created: text('created').notNull(),
  },
  (t) => [index('idx_api_keys_owner').on(t.owner)],
);

export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  windowId: integer('window_id').notNull(),
  hits: integer('hits').notNull(),
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    baselineVersion: integer('baseline_version').notNull(),
    actor: text('actor').notNull(),
    payload: text('payload').notNull(),
    ref: text('ref'),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    created: text('created').notNull(),
    signature: text('signature'),
    context: text('context'),
  },
  (t) => [
    uniqueIndex('idx_ledger_project_seq').on(t.projectId, t.seq),
    uniqueIndex('idx_ledger_project_ref').on(t.projectId, t.ref),
  ],
);

export const accountSettings = pgTable('account_settings', {
  owner: text('owner').primaryKey(),
  contextRetentionDays: integer('context_retention_days'),
  emailSubject: text('email_subject'),
  emailBody: text('email_body'),
  defaultExclusions: text('default_exclusions'),
  defaultTerms: text('default_terms'),
  draftExpiryDays: integer('draft_expiry_days'),
  mode: text('mode').notNull().default('freelancer'),
  country: text('country'),
  timezone: text('timezone'),
  onboarded: text('onboarded'),
  themeStyle: text('theme_style'),
  themeMode: text('theme_mode'),
  updated: text('updated').notNull(),
});

export const businessProfiles = pgTable('business_profiles', {
  owner: text('owner').primaryKey(),
  businessName: text('business_name'),
  businessAddress: text('business_address'),
  taxId: text('tax_id'),
  paymentDetails: text('payment_details'),
  invoicePrefix: text('invoice_prefix'),
  defaultCurrency: text('default_currency'),
  defaultTaxLabel: text('default_tax_label'),
  defaultTaxPct: doublePrecision('default_tax_pct'),
  defaultDepositPct: doublePrecision('default_deposit_pct'),
  defaultPaymentTerms: text('default_payment_terms'),
  autoRemindDays: integer('auto_remind_days'),
  nextInvoice: integer('next_invoice').notNull().default(1),
  gstState: text('gst_state'),
  sacCode: text('sac_code'),
  lutArn: text('lut_arn'),
  brandColor: text('brand_color'),
  logo: text('logo'),
  replyTo: text('reply_to'),
  logoHash: text('logo_hash'),
  upiVpa: text('upi_vpa'),
  udyamNumber: text('udyam_number'),
  udyamDate: text('udyam_date'),
  udyamCategory: text('udyam_category'),
  updated: text('updated').notNull(),
});

export const drafts = pgTable('drafts', {
  owner: text('owner').primaryKey(),
  content: text('content').notNull(),
  updated: text('updated').notNull(),
});

export const templates = pgTable('templates', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  tags: text('tags').notNull().default('[]'),
  revision: integer('revision').notNull().default(1),
  shareToken: text('share_token'),
  origin: text('origin'),
  created: text('created').notNull(),
  updated: text('updated').notNull(),
});

export const templateRevisions = pgTable(
  'template_revisions',
  {
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    name: text('name').notNull(),
    content: text('content').notNull(),
    created: text('created').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.revision] })],
);

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    provider: text('provider').notNull(),
    orderId: text('order_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('created'),
    paymentId: text('payment_id'),
    eventId: text('event_id'),
    created: text('created').notNull(),
    paidAt: text('paid_at'),
    checked: text('checked'),
    purpose: text('purpose').notNull().default('deposit'),
    invoiceSeq: integer('invoice_seq'),
  },
  (t) => [uniqueIndex('idx_payments_order').on(t.provider, t.orderId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    seq: integer('seq').notNull(),
    number: text('number').notNull(),
    version: integer('version').notNull(),
    amount: doublePrecision('amount').notNull(),
    currency: text('currency').notNull(),
    issued: text('issued').notNull(),
    requestId: text('request_id'),
    content: text('content').notNull(),
    currencyExponent: smallint('currency_exponent'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    tdsMinor: bigint('tds_minor', { mode: 'number' }),
    grossMinor: bigint('gross_minor', { mode: 'number' }),
  },
  (t) => [
    uniqueIndex('invoices_owner_seq_key').on(t.owner, t.seq),
    uniqueIndex('invoices_owner_request_id_key').on(t.owner, t.requestId),
    index('idx_invoices_project').on(t.projectId),
  ],
);

export const reviewViews = pgTable(
  'review_views',
  {
    projectId: text('project_id').notNull(),
    version: integer('version').notNull(),
    firstViewed: text('first_viewed').notNull(),
    lastViewed: text('last_viewed').notNull(),
    views: integer('views').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.version] })],
);

export const versionCosigns = pgTable(
  'version_cosigns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    cosignerId: text('cosigner_id').notNull(),
    role: text('role').notNull(),
    signer: text('signer').notNull(),
    signed: text('signed').notNull(),
    signature: text('signature'),
    context: text('context'),
  },
  (t) => [uniqueIndex('version_cosigns_unique').on(t.projectId, t.version, t.cosignerId)],
);

export const reviewOtps = pgTable('review_otps', {
  id: text('id').primaryKey(),
  versionId: text('version_id')
    .notNull()
    .references(() => versions.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expires: text('expires').notNull(),
  created: text('created').notNull(),
  verified: text('verified'),
  sessionHash: text('session_hash'),
  channel: text('channel').notNull().default('email'),
  action: text('action').notNull().default('decision'),
  target: text('target'),
  consumed: text('consumed'),
});

export const timestamps = pgTable(
  'timestamps',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    subject: text('subject').notNull(),
    digest: text('digest').notNull(),
    tsa: text('tsa').notNull(),
    token: text('token').notNull(),
    genTime: text('gen_time').notNull(),
    created: text('created').notNull(),
  },
  (t) => [uniqueIndex('timestamps_unique').on(t.projectId, t.subject, t.digest)],
);

export const accountsPlans = pgTable('accounts_plans', {
  owner: text('owner').primaryKey(),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  periodEnd: text('period_end'),
  graceUntil: text('grace_until'),
  provider: text('provider'),
  providerCustomer: text('provider_customer'),
  providerSubscription: text('provider_subscription'),
  interval: text('interval'),
  updated: text('updated').notNull(),
});

export const billingInvoices = pgTable('billing_invoices', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  seq: integer('seq').notNull().unique(),
  number: text('number').notNull().unique(),
  provider: text('provider').notNull(),
  providerPayment: text('provider_payment'),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  issued: text('issued').notNull(),
  content: text('content').notNull(),
});

export const auditEvents = pgTable('audit_events', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail').notNull(),
  actor: text('actor').notNull(),
  created: text('created').notNull(),
});

export const analyticsOptOut = pgTable('analytics_opt_out', {
  owner: text('owner').primaryKey(),
  created: text('created').notNull(),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: integer('status'),
    body: text('body'),
    created: text('created').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  secretHash: text('secret_hash'),
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').notNull(),
  authMethod: text('auth_method').notNull(),
  created: text('created').notNull(),
});

export const oauthCodes = pgTable('oauth_codes', {
  hash: text('hash').primaryKey(),
  clientId: text('client_id').notNull(),
  owner: text('owner').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  challenge: text('challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  expires: text('expires').notNull(),
  family: text('family'),
  used: text('used'),
});

export const oauthTokens = pgTable('oauth_tokens', {
  hash: text('hash').primaryKey(),
  kind: text('kind').notNull(),
  clientId: text('client_id').notNull(),
  owner: text('owner').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  expires: text('expires').notNull(),
  created: text('created').notNull(),
  family: text('family'),
  rotated: text('rotated'),
});

export const oauthGrants = pgTable('oauth_grants', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  clientId: text('client_id').notNull(),
  clientName: text('client_name').notNull(),
  domain: text('domain').notNull(),
  verified: boolean('verified').notNull().default(false),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  created: text('created').notNull(),
  lastUsed: text('last_used'),
  revoked: text('revoked'),
  revokedReason: text('revoked_reason'),
});

export const versionLinks = pgTable(
  'version_links',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    linkIssued: text('link_issued'),
    firstSent: text('first_sent'),
    sentVia: text('sent_via'),
    cosigners: text('cosigners'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.version] })],
);

export const cosignInvites = pgTable(
  'cosign_invites',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    cosignerId: text('cosigner_id').notNull(),
    role: text('role').notNull(),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    token: text('token').notNull().unique(),
    created: text('created').notNull(),
  },
  (t) => [uniqueIndex('cosign_invites_unique').on(t.projectId, t.version, t.cosignerId)],
);

export const versionLinkAliases = pgTable('version_link_aliases', {
  token: text('token').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  reason: text('reason').notNull(),
  created: text('created').notNull(),
});

export const ownerTombstones = pgTable('owner_tombstones', {
  owner: text('owner').primaryKey(),
  deleted: text('deleted').notNull(),
  retainUntil: text('retain_until').notNull(),
  projectsKept: integer('projects_kept').notNull(),
  loginDeleted: boolean('login_deleted').notNull().default(false),
});

export const inboundMessages = pgTable('inbound_messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  messageId: text('message_id'),
  received: text('received').notNull(),
  sender: text('sender'),
  subject: text('subject'),
  body: text('body').notNull(),
  radar: text('radar'),
  status: text('status').notNull().default('new'),
});

export const invoiceReminders = pgTable(
  'invoice_reminders',
  {
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    sent: text('sent').notNull(),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.sent] })],
);

export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    owner: text('owner').notNull(),
    provider: text('provider').notNull(),
    accountId: text('account_id').notNull(),
    status: text('status').notNull().default('connected'),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    displayName: text('display_name'),
    country: text('country'),
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    connected: text('connected').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.provider] })],
);

export const deletionAudit = pgTable('deletion_audit', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  owner: text('owner'),
  actor: text('actor').notNull(),
  dbRole: text('db_role').notNull(),
  outcome: text('outcome').notNull(),
  versionsDeleted: integer('versions_deleted').notNull().default(0),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
});
