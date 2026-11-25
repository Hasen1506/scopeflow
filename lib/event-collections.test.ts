import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScopeFromEventVendor,
  buildVendorWhatsAppConfirm,
  cleanLegacyPhantomGuests,
  computeCollectionTotals,
  createCollectionFromBlueprint,
  eventCollectionPayloadSchema,
  sanitizePhoneDigits,
  summarizeCollectionForAI,
} from './event-collections';
import { scopeSchema } from './scope';

test('marriage blueprint populates 6 customizable sub-events and linked vendors with contact phones', () => {
  const col = createCollectionFromBlueprint('marriage', {
    title: 'Sharma–Verma Wedding',
    city: 'Jaipur',
    jurisdiction: 'IN-KA',
  });

  assert.equal(col.title, 'Sharma–Verma Wedding');
  assert.equal(col.city, 'Jaipur');
  assert.equal(col.subEvents.length, 6);
  assert.deepEqual(
    col.subEvents.map((s) => s.title),
    [
      'Engagement & Ring Ceremony',
      'Mehendi Afternoon',
      'Haldi Morning',
      'Sangeet & Cocktail Night',
      'Wedding Ceremony (Muhurtham / Pheras)',
      'Reception Dinner',
    ],
  );
  assert.ok(col.vendors.length >= 4);
  assert.ok(col.vendors.every((v) => v.contactPerson.length > 0 && v.contactPhone.length > 0));
  assert.equal(eventCollectionPayloadSchema.safeParse(col).success, true);
});

test('computeCollectionTotals accurately rolls up budget, advance paid, balance, and vendor protection', () => {
  const col = createCollectionFromBlueprint('marriage');
  const totals = computeCollectionTotals(col);

  assert.equal(totals.subEventCount, 6);
  assert.equal(totals.vendorCount, 4);
  assert.equal(totals.totalBudget, 340000 + 75000 + 210000 + 185000);
  assert.equal(totals.totalAdvancePaid, 85000 + 25000 + 60000 + 55000);
  assert.equal(totals.totalBalanceDue, totals.totalBudget - totals.totalAdvancePaid);
  assert.equal(totals.confirmedCount, 1);
  assert.equal(totals.unprotectedCount, 3);
  assert.equal(totals.totalGuestsPeak, 400);
});

test('buildVendorWhatsAppConfirm formats phone number into wa.me link with fee, advance, UTR, and venue', () => {
  const col = createCollectionFromBlueprint('marriage');
  const caterer = col.vendors[0];
  const { message, waHref } = buildVendorWhatsAppConfirm(col, caterer);

  assert.equal(sanitizePhoneDigits('+91 98801 44556'), '919880144556');
  assert.ok(waHref.startsWith('https://wa.me/919880144556?text='));
  assert.match(message, /Saffron Kitchen Catering/);
  assert.match(message, /Reception Dinner/);
  assert.match(message, /UTR42901847261/);
  assert.match(message, /Please reply "Confirmed"/);
});

test('buildScopeFromEventVendor produces a valid scopeSchema document ready for TermsLock editor', () => {
  const col = createCollectionFromBlueprint('marriage');
  const vendor = col.vendors[0];
  const scope = buildScopeFromEventVendor(col, vendor);

  const parsed = scopeSchema.safeParse(scope);
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.equal(scope.client, vendor.vendorName);
  assert.equal(scope.fee, vendor.agreedFee);
  assert.equal(scope.deposit_pct, 25);
  assert.match(scope.notes, /Vikram Shetty/);
  assert.match(scope.notes, /\+91 98801 44556/);
});

test('summarizeCollectionForAI includes sub-events, vendors, and balances for Gemini context', () => {
  const col = createCollectionFromBlueprint('marriage');
  const summary = summarizeCollectionForAI(col);

  assert.match(summary, /Eashwaren–Apoorva Wedding/);
  assert.match(summary, /Sangeet & Cocktail Night/);
  assert.match(summary, /Saffron Kitchen Catering/);
  assert.match(summary, /1\/4 vendors confirmed/);
});

test('custom blank blueprint defaults guestCount to 0 and cleanLegacyPhantomGuests strips untouched legacy 50-guest rows only', () => {
  const fresh = createCollectionFromBlueprint('custom');
  assert.equal(fresh.subEvents[0]?.guestCount, 0);

  const legacyUntouched = {
    ...fresh,
    subEvents: [
      { ...fresh.subEvents[0], title: 'Event Day 1', guestCount: 50 },
      { ...fresh.subEvents[0], id: 'sub_legacy_phase', title: 'Main Event / Phase 1', guestCount: 50 },
    ],
  };
  const cleaned = cleanLegacyPhantomGuests(legacyUntouched);
  assert.equal(cleaned.subEvents[0]?.guestCount, 0);
  assert.equal(cleaned.subEvents[1]?.guestCount, 0);
  assert.equal(computeCollectionTotals(cleaned).totalGuestsPeak, 0);

  // If user actually customized the row (e.g. added a venue or renamed it), keep their 50 guests intact.
  const userCustomized = {
    ...fresh,
    subEvents: [{ ...fresh.subEvents[0], venueName: 'Terrace Hall', guestCount: 50 }],
  };
  assert.equal(cleanLegacyPhantomGuests(userCustomized).subEvents[0]?.guestCount, 50);
});
