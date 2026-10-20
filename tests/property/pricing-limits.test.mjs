// Pricing math and limit enforcement. Pure. Seeded.
// @covers M13 L13
import '../support/fc-setup.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fc} from '../support/property.mjs';

const P = await import('../../lib/plans.ts');
const {teamPowers} = await import('../../lib/team-core.ts');

const purchasable = ['pro', 'agency'];

test('yearly is ten times monthly, founding is below list, and minor units are exact', () => {
  for (const id of purchasable) {
    const p = P.PLANS[id];
    assert.equal(p.price.INR_year, p.price.INR * 10, id);
    assert.equal(p.price.USD_year, p.price.USD * 10, id);
    assert.ok(p.founding);
    assert.equal(p.founding.INR_year, p.founding.INR * 10, id);
    assert.equal(p.founding.USD_year, p.founding.USD * 10, id);
    assert.ok(p.founding.INR >= Math.floor(p.price.INR / 2) && p.founding.INR < p.price.INR, id);
    assert.ok(p.founding.USD >= Math.floor(p.price.USD / 2) && p.founding.USD < p.price.USD, id);
    for (const currency of ['INR', 'USD']) {
      for (const interval of ['month', 'year']) {
        assert.equal(P.chargeMinor(id, interval, currency, false), P.listPrice(id, interval, currency, false) * 100);
        assert.equal(P.chargeMinor(id, interval, currency, true), P.listPrice(id, interval, currency, true) * 100);
        assert.ok(P.chargeMinor(id, interval, currency, true) < P.chargeMinor(id, interval, currency, false));
      }
    }
  }
  assert.equal(P.chargeMinor('pro', 'month', 'INR', false), 79900);
  assert.equal(P.chargeMinor('pro', 'month', 'INR', true), 39900);
  assert.equal(P.chargeMinor('agency', 'year', 'USD', false), 29000);
  assert.equal(P.chargeMinor('agency', 'month', 'INR', true), 129900);
});

test('founding seats close at 100 and after 30 June 2027, and the lock is 24 months', () => {
  const before = Date.parse('2027-06-30T23:59:59.999Z');
  const after = before + 1;
  assert.equal(P.foundingOpen(0, before), true);
  assert.equal(P.foundingOpen(99, before), true);
  assert.equal(P.foundingOpen(100, before), false);
  assert.equal(P.foundingOpen(99, after), false);
  assert.equal(P.foundingOpen(-1, before), false);
  assert.equal(P.FOUNDING_SEATS, 100);
  assert.equal(P.FOUNDING_LOCK_MONTHS, 24);
  assert.equal(P.foundingUntil(Date.parse('2026-10-19T00:00:00.000Z')), '2028-10-19T00:00:00.000Z');
  assert.equal(P.addMonthsUtc(Date.parse('2026-01-31T00:00:00.000Z'), 1), '2026-02-28T00:00:00.000Z');
  fc.assert(fc.property(fc.integer({min: 0, max: 500}), fc.integer({min: Date.parse('2026-01-01'), max: Date.parse('2028-01-01')}), (taken, now) =>
    P.foundingOpen(taken, now) === (taken < 100 && now <= P.FOUNDING_DEADLINE_MS)));
});

test('caps refuse at the boundary and gates match the plan', () => {
  fc.assert(fc.property(fc.integer({min: 1, max: 200}), fc.integer({min: 0, max: 250}), fc.boolean(), (cap, n, already) =>
    (P.clientCapError(n, already, {clients: cap}) === null) === (already || n < cap)));
  fc.assert(fc.property(fc.integer({min: 1, max: 20}), fc.integer({min: 0, max: 30}), (cap, used) =>
    (P.seatCapError(used, {seats: cap}) === null) === (used < cap)));
  assert.equal(P.clientCapError(8, false, P.PLANS.free.limits), P.clientCapError(8, false, {clients: 8}));
  assert.equal(P.clientCapError(8, true, P.PLANS.free.limits), null);
  assert.match(P.seatCapError(1, P.PLANS.free.limits), /1 seat/);
  assert.equal(P.seatCapError(4, P.PLANS.agency.limits), null);
  assert.match(P.seatCapError(5, P.PLANS.agency.limits), /5 seats/);
  const matrix = {
    free: {ai: false, api: false, reminders: false, retainers: false, team: false},
    pro: {ai: true, api: true, reminders: true, retainers: true, team: false},
    agency: {ai: true, api: true, reminders: true, retainers: true, team: true},
    beta: {ai: true, api: true, reminders: true, retainers: true, team: true},
  };
  for (const [id, gates] of Object.entries(matrix)) {
    for (const [gate, on] of Object.entries(gates)) assert.equal(P.allows(id, gate), on, id + ' ' + gate);
  }
  assert.equal(P.featureDenied('team').code, 'plan_feature');
  assert.deepEqual([P.PLANS.free.limits.projects, P.PLANS.pro.limits.projects, P.PLANS.agency.limits.projects], [3, 15, 40]);
  assert.deepEqual([P.PLANS.free.limits.clients, P.PLANS.pro.limits.clients, P.PLANS.agency.limits.clients], [8, 40, 120]);
});

test('studio roles differ, and a member cannot issue links or edit the rate card', () => {
  const owner = teamPowers('owner'), manager = teamPowers('manager'), member = teamPowers('member'), finance = teamPowers('finance');
  assert.equal(owner.invite && owner.issueLinks && owner.editScope && owner.editRateCard, true);
  assert.equal(manager.invite, false);
  assert.equal(manager.issueLinks && manager.editScope && manager.editRateCard, true);
  assert.equal(member.editScope, true);
  assert.equal(member.issueLinks || member.editRateCard || member.invite, false);
  assert.equal(finance.editRateCard && finance.readRateCard, true);
  assert.equal(finance.editScope || finance.issueLinks || finance.invite, false);
});
