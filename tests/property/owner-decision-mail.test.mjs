// The email a freelancer receives when a client approves or asks for changes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../support/ts-resolve.mjs';

const {ownerDecisionEmail} = await import('../../lib/mail.ts');

test('owner decision mail names the decision, the version, and the comment', () => {
  const approved = ownerDecisionEmail({decision: 'approved', title: 'Logo suite', signer: 'Ada Client', version: 2, comment: '', workspaceUrl: 'https://scope-flow.tech/'});
  assert.match(approved.subject, /Ada Client approved/);
  assert.match(approved.subject, /version 2/);
  assert.match(approved.text, /No comment was added/);
  assert.match(approved.text, /https:\/\/scope-flow\.tech\//);
  const changes = ownerDecisionEmail({decision: 'changes_requested', title: 'Logo suite', signer: 'Ada Client', version: 1, comment: 'Please drop printing.', workspaceUrl: 'https://scope-flow.tech/'});
  assert.match(changes.subject, /requested changes/);
  assert.match(changes.text, /Please drop printing/);
  assert.doesNotMatch(changes.html, /<script/);
});
