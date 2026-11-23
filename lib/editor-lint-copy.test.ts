import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeFieldCopy } from './editor';
import { applyRewrite, lintScope } from './lint';
import { blank, sample, type Scope } from './scope';

test('scopeFieldCopy adapts naturally to rental/deposit agreements', () => {
  const rental: Scope = {
    ...blank,
    title: 'Flat 402 Move-In & Deposit Record',
    client: 'Rajesh Sharma',
    notes: 'Refundable security deposit returned within 15 days of key handover.',
  };
  const copy = scopeFieldCopy(rental);
  assert.equal(copy.kind, 'rental');
  assert.equal(copy.title, 'Property / Agreement name');
  assert.equal(copy.counterparty, 'Landlord / Owner');
  assert.equal(copy.fee, 'Security deposit / Agreed amount');
  assert.equal(copy.due, 'Move-in / Handover date');
});

test('scopeFieldCopy adapts naturally to wedding & event agreements', () => {
  const wedding: Scope = {
    ...blank,
    title: 'Reception Dinner Catering — 400 Plates',
    client: 'Saffron Kitchen Catering',
    notes: 'Per-plate rate fixed with +10% buffer.',
  };
  const copy = scopeFieldCopy(wedding);
  assert.equal(copy.kind, 'event');
  assert.equal(copy.title, 'Event / Vendor agreement');
  assert.equal(copy.counterparty, 'Vendor / Host');
  assert.equal(copy.fee, 'Agreed vendor fee');
});

test('scopeFieldCopy adapts naturally to home renovation work orders', () => {
  const reno: Scope = {
    ...blank,
    title: '2BHK Modular Kitchen & Wardrobes BOQ',
    client: 'Studio Craft Interiors',
    notes: 'BWP plywood and snag handover retention.',
  };
  const copy = scopeFieldCopy(reno);
  assert.equal(copy.kind, 'renovation');
  assert.equal(copy.title, 'Renovation / Work order');
  assert.equal(copy.counterparty, 'Contractor / Firm');
  assert.equal(copy.fee, 'Agreed contract value');
});

test('scopeFieldCopy preserves classic labels for default agency/freelance scopes', () => {
  const copy = scopeFieldCopy(sample);
  assert.equal(copy.kind, 'project');
  assert.equal(copy.title, 'Project name');
  assert.equal(copy.counterparty, 'Client');
  assert.equal(copy.fee, 'Project fee');
});

test('lintScope catches rental discretion & mandatory painting traps and applies 1-click rewrites', () => {
  const riskyRental: Scope = {
    ...blank,
    title: 'Flat 402 Apartment Move-In Deposit',
    client: 'Owner',
    fee: 150000,
    currency: 'INR',
    exclusions: 'Extra costs billed as per actuals.',
    notes: "Deposit returned at landlord's discretion after mandatory 1-month painting.",
    items: [{ id: '1', title: 'Security deposit receipt', qty: 1, unit: 'flat', price: 150000, acceptance: 'Key handover' }],
  };
  const res = lintScope(riskyRental, '2026-01-01');
  const discretion = res.issues.find(i => /discretion/i.test(i.message));
  const painting = res.issues.find(i => /painting/i.test(i.message));
  const actuals = res.issues.find(i => /as per actuals/i.test(i.message));
  assert.ok(discretion && discretion.severity === 'error' && discretion.rewrite);
  assert.ok(painting && painting.severity === 'error' && painting.rewrite);
  assert.ok(actuals && actuals.field === 'exclusions' && actuals.rewrite);

  const fixed1 = applyRewrite(riskyRental, discretion!);
  assert.match(fixed1.notes, /written itemized bills within 15 days/i);
  const fixed2 = applyRewrite(fixed1, actuals!);
  assert.match(fixed2.exclusions, /prior written approval and itemized receipts/i);
});

test('lintScope flags missing catering, renovation, and event-vendor protections', () => {
  const catering: Scope = {
    ...blank,
    title: 'Wedding Reception Catering Buffet',
    client: 'Caterer',
    fee: 200000,
    currency: 'INR',
    exclusions: 'Alcohol',
    notes: '50% upfront payment.',
    items: [{ id: '1', title: 'Dinner buffet', qty: 200, unit: 'plates', price: 200000, acceptance: 'Served on event night' }],
  };
  const catRes = lintScope(catering, '2026-01-01');
  assert.ok(catRes.issues.some(i => i.rule === 'category-exclusions' && /catering/i.test(i.message)));

  const reno: Scope = {
    ...blank,
    title: 'Modular Kitchen Renovation BOQ',
    client: 'Contractor',
    fee: 350000,
    currency: 'INR',
    exclusions: 'Appliances',
    notes: 'Payment in 3 parts.',
    items: [{ id: '1', title: 'Modular kitchen', qty: 1, unit: 'unit', price: 350000, acceptance: 'Installed' }],
  };
  const renoRes = lintScope(reno, '2026-01-01');
  assert.ok(renoRes.issues.some(i => i.rule === 'category-exclusions' && /renovation/i.test(i.message)));
});
