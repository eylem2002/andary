import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FOLD_FINISHED_MS, arrangeCrews, crewRank, foldFinished, holdOrder, shownNumber } from '../../../public/js/core/crew-board.js';

/** @param {Record<string, unknown>} fields @returns {any} */
const crew = (fields) => ({ id: 'x', number: 1, status: 'idle', endedAt: undefined, ...fields });
/** @param {Record<string, unknown>} fields @returns {any} */
const agent = (fields) => ({ key: 'k', role: 'subagent', status: 'working', lastActivity: 0, ...fields });

describe('crew board: order', () => {
  it('ranks what needs you first, then the working, then the idle', () => {
    assert.equal(crewRank(crew({ status: 'idle' }), 'blocked'), 0);
    assert.equal(crewRank(crew({ status: 'waiting' }), undefined), 0);
    assert.ok(crewRank(crew({ status: 'working' }), 'ready') < crewRank(crew({ status: 'working' }), undefined));
    assert.ok(crewRank(crew({ status: 'working' }), undefined) < crewRank(crew({ status: 'idle' }), undefined));
  });

  it('puts ten crews in order: needs you, working, idle, with ended ones apart, newest first', () => {
    const sessions = [
      crew({ id: 'idle1', number: 1, status: 'idle' }),
      crew({ id: 'work2', number: 2, status: 'working' }),
      crew({ id: 'gone3', number: 3, status: 'ended', endedAt: 10 }),
      crew({ id: 'stop4', number: 4, status: 'idle' }),
      crew({ id: 'work5', number: 5, status: 'working' }),
      crew({ id: 'ask6', number: 6, status: 'waiting' }),
      crew({ id: 'gone7', number: 7, status: 'ended', endedAt: 30 }),
      crew({ id: 'idle8', number: 8, status: 'idle' }),
      crew({ id: 'done9', number: 9, status: 'idle' }),
      crew({ id: 'gone10', number: 10, status: 'ended', endedAt: 20 }),
    ];
    const needs = new Map([['stop4', /** @type {const} */ ('stopped')], ['done9', /** @type {const} */ ('ready')]]);
    const { live, ended } = arrangeCrews(sessions, needs);
    assert.deepEqual(live.map((s) => s.id), ['ask6', 'stop4', 'done9', 'work2', 'work5', 'idle1', 'idle8']);
    assert.deepEqual(ended.map((s) => s.id), ['gone7', 'gone10', 'gone3']);
    assert.equal(sessions[0].id, 'idle1', 'the store\'s list is left as it is');
  });

  it('holds the order on screen while you read, adding newcomers at the end', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => crew({ id }));
    assert.deepEqual(holdOrder([c, a, d], ['a', 'b', 'c']).map((s) => s.id), ['a', 'c', 'd']);
    assert.deepEqual(holdOrder([b, a], []).map((s) => s.id), ['b', 'a']);
  });

  it('shows no number for an ended crew', () => {
    assert.equal(shownNumber(crew({ number: 4, status: 'working' })), 4);
    assert.equal(shownNumber(crew({ number: 4, status: 'ended' })), 0);
    assert.equal(shownNumber(undefined), 0);
  });
});

describe('crew board: finished helpers', () => {
  it('folds helpers that finished a minute ago, never the lead', () => {
    const now = 1_000_000;
    const agents = [
      agent({ key: 'lead', role: 'lead', status: 'done', lastActivity: 0 }),
      agent({ key: 'old', status: 'done', lastActivity: now - FOLD_FINISHED_MS }),
      agent({ key: 'fresh', status: 'done', lastActivity: now - FOLD_FINISHED_MS + 1 }),
      agent({ key: 'busy', status: 'working', lastActivity: 0 }),
      agent({ key: 'mate', role: 'teammate', status: 'done', lastActivity: 5 }),
    ];
    const { shown, folded } = foldFinished(agents, now);
    assert.deepEqual(shown.map((a) => a.key), ['lead', 'fresh', 'busy']);
    assert.deepEqual(folded.map((a) => a.key), ['old', 'mate']);
  });
});
