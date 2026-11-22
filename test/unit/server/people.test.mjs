import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PEOPLE, PROFILE_EVERY_MS, addPerson, claimHost, createPeople, emptyRoster, peoplePath, readRoster, removePerson, setProfile, updateRoster, writeRoster } from '../../../server/people.mjs';
import { defaultProfile } from '../../../public/js/core/profile.js';

const temp = mkdtempSync(join(tmpdir(), 'people-'));
after(() => rmSync(temp, { recursive: true, force: true }));

/** @param {import('../../../server/people.mjs').Roster} roster @param {string[]} names */
function withPeople(roster, names) {
  return names.reduce((r, name) => /** @type {any} */ (addPerson(r, name)).roster, roster);
}

test('each person gets the first free home and colour, and the host plus five fit', () => {
  const host = /** @type {any} */ (claimHost(emptyRoster(), 'Sam')).roster;
  const roster = withPeople(host, ['Lina', 'Omar', 'Rui', 'Ana', 'Kai']);
  assert.equal(Object.keys(roster.people).length, MAX_PEOPLE);
  assert.deepEqual(Object.values(roster.people).map((p) => p.slot), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(Object.values(roster.people).map((p) => p.color), [0, 1, 2, 3, 4, 5]);
  const seventh = addPerson(roster, 'Zed');
  assert.equal(seventh.ok, false);
  assert.match(seventh.error, /room for 6 people/);
  assert.equal(/** @type {any} */ (addPerson(roster, 'Lina')).added, false, 'inviting again changes nothing');
});

test('a teammate never takes the host\'s place before the host has started', () => {
  const roster = withPeople(emptyRoster(), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(addPerson(roster, 'F').ok, false);
  const hosted = claimHost(roster, 'Sam');
  assert.equal(hosted.ok, true);
  assert.equal(hosted.roster.people.Sam.slot, 5);
});

test('the host is named once, renamed with --name, and never removed', () => {
  const first = /** @type {any} */ (claimHost(emptyRoster(), null)).roster;
  assert.equal(first.host, 'Host');
  const renamed = /** @type {any} */ (claimHost(first, 'Sam')).roster;
  assert.deepEqual(Object.keys(renamed.people), ['Sam']);
  assert.equal(renamed.people.Sam.slot, first.people.Host.slot);
  assert.equal(/** @type {any} */ (claimHost(renamed, null)).roster.host, 'Sam');
  const team = withPeople(renamed, ['Lina']);
  assert.match(claimHost(team, 'Lina').error, /already a teammate/);
  assert.match(removePerson(team, 'Sam').error, /hosts the town/);
  assert.deepEqual(Object.keys(/** @type {any} */ (removePerson(team, 'Lina')).roster.people), ['Sam']);
  assert.equal(removePerson(team, 'Nobody').ok, false);
});

test('a colour someone else has goes to the next free one in order', () => {
  const roster = withPeople(/** @type {any} */ (claimHost(emptyRoster(), 'Sam')).roster, ['Lina', 'Omar']);
  assert.equal(setProfile(roster, 'Lina', { ...defaultProfile(0), color: 2 })?.color, 3, 'Sam has 0, Lina 1, Omar 2');
  assert.equal(setProfile(roster, 'Lina', { ...defaultProfile(0), color: 0 })?.color, 1, 'her own colour is free to her');
  assert.equal(setProfile(roster, 'Lina', { ...defaultProfile(0), color: 6 })?.color, 6);
  assert.equal(setProfile(roster, 'Nobody', defaultProfile(0)), null);
  // The name a character shows is never another person's, on the roster or chosen.
  assert.match(setProfile(roster, 'Lina', { ...defaultProfile(0), name: 'omar' })?.error ?? '', /Another person is called omar/);
  const named = /** @type {any} */ (setProfile(roster, 'Omar', { ...defaultProfile(2), name: 'Ozzy' })).roster;
  assert.match(setProfile(named, 'Lina', { ...defaultProfile(0), name: 'OZZY' })?.error ?? '', /Another person/);
  assert.equal(setProfile(named, 'Omar', { ...defaultProfile(2), name: 'Ozzy' })?.error, undefined, 'their own name is theirs');
  // Agents' names count too, both ways, and so do look-alike letters and the town's own words.
  const pixel = /** @type {any} */ (setProfile(named, 'Omar', { ...defaultProfile(2), name: 'Ozzy', agents: 'Pixel' })).roster;
  assert.match(setProfile(pixel, 'Lina', { ...defaultProfile(0), name: 'Pixel 2' })?.error ?? '', /Another person/);
  assert.match(setProfile(pixel, 'Lina', { ...defaultProfile(0), agents: 'Оzzy' })?.error ?? '', /Another person/, 'Cyrillic О');
  assert.match(setProfile(pixel, 'Lina', { ...defaultProfile(0), agents: 'Scout' })?.error ?? '', /the town uses/);
});

test('people.json is private, and a broken or hand-edited file never breaks the town', () => {
  const home = join(temp, 'file');
  writeRoster(home, withPeople(/** @type {any} */ (claimHost(emptyRoster(), 'Sam')).roster, ['Lina']));
  if (process.platform !== 'win32') assert.equal(statSync(peoplePath(home)).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(readRoster(home).people), ['Sam', 'Lina']);
  writeFileSync(peoplePath(home), JSON.stringify({ v: 1, host: 'Ghost', people: {
    Sam: { slot: 0, color: 0, profile: { v: 1, color: 'red' } },
    Twin: { slot: 0, color: 3, profile: null },
    '<b>': { slot: 2, color: 2, profile: null },
    Lina: { slot: 9, color: 1, profile: null },
    Omar: { slot: 3, color: 4, profile: defaultProfile(4) },
  } }));
  const roster = readRoster(home);
  assert.deepEqual(Object.keys(roster.people), ['Sam', 'Omar']);
  assert.equal(roster.people.Sam.profile, null, 'a bad profile is cleared');
  assert.deepEqual(roster.people.Omar.profile, defaultProfile(4));
  assert.equal(roster.host, null, 'a host who is not on the roster is no host');
  writeFileSync(peoplePath(home), 'not json');
  assert.deepEqual(readRoster(home), emptyRoster());
});

test('the running host sees CLI edits, saves profiles at most every 10 s, and lists by home', async () => {
  const home = join(temp, 'live');
  let clock = 0;
  let changes = 0;
  const people = createPeople({ home, host: 'Sam', now: () => clock, onChange: () => (changes += 1) });
  assert.equal(people.host, 'Sam');
  writeRoster(home, withPeople(readRoster(home), ['Lina']));
  people.poll();
  await Promise.resolve();
  assert.equal(changes, 1);
  assert.equal(people.has('Lina'), true);
  // A key check that sees a change first must not swallow it: the change is still announced.
  writeRoster(home, withPeople(readRoster(home), ['Omar']));
  assert.equal(people.has('Omar'), true);
  people.poll();
  await Promise.resolve();
  assert.equal(changes, 2, 'once, whoever saw it first');
  const { Omar: _gone, ...rest } = readRoster(home).people;
  writeRoster(home, { ...readRoster(home), people: rest });
  assert.deepEqual(people.list().map((p) => [p.name, p.slot, p.host]), [['Sam', 0, true], ['Lina', 1, false]]);
  assert.deepEqual(people.setProfile('Lina', defaultProfile(5)), { color: 5 });
  assert.equal(readRoster(home).people.Lina.color, 5, 'saved to people.json');
  assert.deepEqual(people.setProfile('Lina', defaultProfile(6)), { wait: true });
  clock += PROFILE_EVERY_MS;
  assert.deepEqual(people.setProfile('Lina', defaultProfile(6)), { color: 6 });
  assert.equal(people.setProfile('Omar', defaultProfile(2)), null);
  assert.throws(() => createPeople({ home, host: 'Lina' }), /already a teammate/);
});

test('nonces: a new one for each invite after a removal, the same one when invited again', () => {
  const roster = withPeople(/** @type {any} */ (claimHost(emptyRoster(), 'Sam')).roster, ['Lina']);
  const first = roster.people.Lina.nonce;
  assert.match(first, /^[\w-]{16}$/);
  assert.equal(/** @type {any} */ (addPerson(roster, 'Lina')).roster.people.Lina.nonce, first);
  const again = withPeople(/** @type {any} */ (removePerson(roster, 'Lina')).roster, ['Lina']);
  assert.notEqual(again.people.Lina.nonce, first);
});

test('the host\'s name is never a teammate\'s, and "Host" makes way for a teammate called Host', () => {
  const roster = withPeople(/** @type {any} */ (claimHost(emptyRoster(), 'Sam')).roster, ['Lina']);
  assert.match(addPerson(roster, 'Sam').error ?? '', /hosts the town/);
  const team = withPeople(emptyRoster(), ['Host']);
  assert.equal(/** @type {any} */ (claimHost(team, null)).roster.host, 'Host 2');
  const logs = /** @type {string[]} */ ([]);
  const home = join(temp, 'host2');
  writeRoster(home, team);
  createPeople({ home, host: null, log: (m) => logs.push(m) });
  assert.match(logs[0], /you are Host 2/);
});

test('every read-modify-write holds the lock; a lock left behind is taken over', () => {
  const home = join(temp, 'lock');
  writeRoster(home, emptyRoster());
  writeFileSync(join(home, 'people.lock'), '1');
  utimesSync(join(home, 'people.lock'), new Date(0), new Date(0));
  const result = updateRoster(home, (r) => claimHost(r, 'Sam'));
  assert.equal(result.ok, true);
  assert.equal(readRoster(home).host, 'Sam');
  assert.equal(existsSync(join(home, 'people.lock')), false, 'let go afterwards');
  writeFileSync(join(home, 'people.lock'), '1');
  assert.throws(() => updateRoster(home, (r) => claimHost(r, 'Sam')), /busy/);
});
