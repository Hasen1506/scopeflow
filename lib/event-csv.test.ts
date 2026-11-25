import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionFromBlueprint } from './event-collections';
import {
  buildSubEventsCsv,
  buildSubEventsCsvFilename,
  csvEscapeCell,
  SUB_EVENTS_CSV_HEADERS,
} from './event-csv';

test('csvEscapeCell escapes commas, quotes, newlines, and spreadsheet formulas', () => {
  assert.equal(csvEscapeCell('Haldi Morning'), 'Haldi Morning');
  assert.equal(csvEscapeCell('Lawn, Poolside'), '"Lawn, Poolside"');
  assert.equal(csvEscapeCell('Grand "Royal" Hall'), '"Grand ""Royal"" Hall"');
  assert.equal(csvEscapeCell('Line 1\nLine 2'), '"Line 1\nLine 2"');
  assert.equal(csvEscapeCell('=SUM(A1:A5)'), "'=SUM(A1:A5)");
  assert.equal(csvEscapeCell('+91 98450 11223'), "'+91 98450 11223");
  assert.equal(csvEscapeCell(85000), '85000');
});

test('buildSubEventsCsv exports header row and accurate financial rollups per sub-event', () => {
  const wedding = createCollectionFromBlueprint('marriage');
  const csv = buildSubEventsCsv(wedding);
  const lines = csv.split('\r\n');

  assert.equal(lines.length, 1 + wedding.subEvents.length);
  assert.equal(lines[0], SUB_EVENTS_CSV_HEADERS.join(','));

  // Reception Dinner (index 5) has Saffron Kitchen Catering (340000 agreed, 85000 paid, 255000 balance)
  // plus 1 shared vendor (Frame & Light Collective) -> 2 vendors linked
  const receptionRow = lines.find((line) => line.includes('Reception Dinner'));
  assert.ok(receptionRow, 'Expected Reception Dinner row in CSV');
  assert.ok(receptionRow.includes(',Planning,'), 'Expected human-readable status label');
  assert.ok(receptionRow.includes(',2,340000,85000,255000,INR,'), `Unexpected financials in row: ${receptionRow}`);
});

test('buildSubEventsCsv respects a filtered subset of sub-events', () => {
  const wedding = createCollectionFromBlueprint('marriage');
  const onlyHaldi = wedding.subEvents.filter((s) => s.title.includes('Haldi'));
  const csv = buildSubEventsCsv(wedding, onlyHaldi);
  const lines = csv.split('\r\n');

  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('Haldi Morning'));
});

test('buildSubEventsCsvFilename creates clean lowercase slugs with fallback', () => {
  assert.equal(
    buildSubEventsCsvFilename('Eashwaren–Apoorva Wedding'),
    'eashwaren-apoorva-wedding-sub-events.csv',
  );
  assert.equal(buildSubEventsCsvFilename('   !!!   '), 'event-collection-sub-events.csv');
});
