// Identifiers that the server and the browser must read the same way (CONTRACTS §4.2). Pure, so
// the server imports this module too.

/**
 * `andary doctor` sends a probe through the real pipeline under this session-id prefix
 * (server/cli/doctor.mjs). It proves delivery, so the town shows nothing for it and a teammate's
 * relay does not pass it on.
 */
export const DOCTOR_SESSION_PREFIX = 'andary-doctor-';

/**
 * Hook payloads name subagents "agent-abc123" in some places and "abc123" in others: ids are
 * compared without the prefix.
 * @param {unknown} id
 * @returns {string|null}
 */
export function normalizeAgentId(id) {
  // Numbers are ids too (some payloads send them unquoted).
  const value = typeof id === 'string' ? id.trim() : typeof id === 'number' && Number.isFinite(id) ? String(id) : '';
  if (!value) return null;
  return value.startsWith('agent-') && value.length > 6 ? value.slice(6) : value;
}

/**
 * The key of an agent in a session: "<session>:<agent id>", or "<session>:main" for the lead.
 * @param {string} sessionId
 * @param {string|null} [agentId]  already normalized
 */
export function agentKeyOf(sessionId, agentId) {
  return `${sessionId}:${agentId ?? 'main'}`;
}

/**
 * @param {unknown} sessionId
 * @returns {boolean}
 */
export function isDoctorSession(sessionId) {
  return typeof sessionId === 'string' && sessionId.startsWith(DOCTOR_SESSION_PREFIX);
}
