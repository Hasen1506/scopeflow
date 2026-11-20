import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAgreementText, buildEscalationLadder, JURISDICTIONS, SCENARIOS} from './legal-shield';
import {buildGuidedScope, GUIDED_PACKS} from './protection-packs';
import {scopeSchema} from './scope';

test('rental trap scanner catches blanket painting, non-refundable deposit, and discretionary return', () => {
  const sample = SCENARIOS.find(s => s.id === 'rental')!.sampleClause;
  const report = analyzeAgreementText(sample, 'rental', 'IN-KA');
  assert.equal(report.riskLevel, 'high');
  assert.ok(report.score < 50, `expected high risk score < 50, got ${report.score}`);
  const ids = report.findings.map(f => f.id);
  assert.ok(ids.includes('painting-deduction'), 'detects blanket painting deduction');
  assert.ok(ids.includes('non-refundable-deposit'), 'detects non-refundable deposit');
  assert.ok(ids.includes('discretionary-refund'), 'detects landlord discretion');
  assert.ok(report.missingProtections.some(m => m.id === 'missing-return-window'), 'flags missing fixed return deadline');
  assert.ok(report.missingProtections.some(m => m.id === 'missing-inventory'), 'flags missing move-in inventory');
});

test('jurisdiction rules reflect California 21-day and New York 14-day deposit laws', () => {
  const ca = analyzeAgreementText('Deposit is non-refundable.', 'rental', 'US-CA');
  assert.equal(ca.jurisdiction.returnWindowDays, 21);
  assert.equal(ca.jurisdiction.currency, 'USD');
  assert.match(ca.jurisdiction.depositCapNote, /AB 12|1 month/i);

  const ny = analyzeAgreementText('Deposit is non-refundable.', 'rental', 'US-NY');
  assert.equal(ny.jurisdiction.returnWindowDays, 14);
  assert.match(ny.jurisdiction.returnWindowNote, /14 calendar days/i);
});

test('catering scanner catches uncapped extra plates, cash-only, and vague menu', () => {
  const sample = SCENARIOS.find(s => s.id === 'catering')!.sampleClause;
  const report = analyzeAgreementText(sample, 'catering', 'IN-MH');
  assert.equal(report.riskLevel, 'high');
  const ids = report.findings.map(f => f.id);
  assert.ok(ids.includes('non-refundable-deposit'));
  assert.ok(ids.includes('uncapped-overage'));
  assert.ok(ids.includes('cash-only'));
  assert.ok(ids.includes('vague-materials-or-menu'));
});

test('clean protective rental text scores as protected', () => {
  const clean =
    'Refundable security deposit returned within 15 calendar days of key handover. Move-in photo inventory and meter readings shared on Day 1. Normal wear and tear is excluded; deductions require itemized bills.';
  const report = analyzeAgreementText(clean, 'rental', 'IN-KA');
  assert.equal(report.riskLevel, 'protected');
  assert.equal(report.findings.length, 0);
  assert.equal(report.missingProtections.length, 0);
});

test('3-level escalation ladder builds valid WhatsApp URL, soft confirm, and unilateral notice', () => {
  const ladder = buildEscalationLadder({
    scenario: 'rental',
    jurisdiction: 'US-CA',
    partyName: 'Alex Landlord',
    yourName: 'Priya Tenant',
    subject: 'Apt 3B, Market St',
    amount: 2800,
    date: '2026-12-01',
  });
  assert.ok(ladder.level1WhatsApp.waHref.startsWith('https://wa.me/?text='));
  assert.match(ladder.level1WhatsApp.message, /21 days/);
  assert.match(ladder.level1WhatsApp.message, /\$2,800/);
  assert.ok(ladder.level3Unilateral.checklist.length >= 3);
  assert.match(ladder.level3Unilateral.noticeTemplate, /Cal\. Civ\. Code/);
});

test('every 30-second guided pack compiles to a 100% scopeSchema-valid Scope across IN and US', () => {
  assert.equal(GUIDED_PACKS.length, 6);
  for (const pack of GUIDED_PACKS) {
    for (const jur of ['IN-KA', 'US-CA'] as const) {
      const {scope, whatsappRecap} = buildGuidedScope({
        packId: pack.id,
        jurisdiction: jur,
        subject: 'Sample Test Agreement',
        party: 'Test Counterparty',
        amount: 50000,
        date: '2026-12-15',
      });
      const parsed = scopeSchema.safeParse(scope);
      assert.ok(
        parsed.success,
        `${pack.id} (${jur}) failed scopeSchema: ${parsed.success ? '' : parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      assert.ok(whatsappRecap.includes('Test Counterparty'));
    }
  }
  assert.ok(JURISDICTIONS.length >= 9);
});
