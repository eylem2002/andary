import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickEviction } from '../../../public/js/ui/toasts.js';

const achievement = { action: false, group: 'achievement', held: false };
const crew = { action: true, group: 'crew', held: false };
const approval = { action: true, group: '', held: false };

test('the oldest toast without a button makes room first', () => {
  // Newest first: [new achievement, approval, older achievement]
  assert.equal(pickEviction([achievement, approval, achievement]), 2);
});

test('a crew arrival goes before an approval, whatever their age', () => {
  assert.equal(pickEviction([approval, crew, approval]), 1);
  assert.equal(pickEviction([crew, approval]), 0);
});

test('of two approvals the older goes', () => {
  assert.equal(pickEviction([approval, approval, approval]), 2);
});

test('a toast under the pointer or the keyboard is never pushed out', () => {
  assert.equal(pickEviction([approval, { ...crew, held: true }]), 0);
  assert.equal(pickEviction([{ ...approval, held: true }, { ...crew, held: true }]), -1);
});
