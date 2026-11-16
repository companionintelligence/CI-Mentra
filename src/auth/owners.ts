import { config } from '../config.ts';
import pino from 'pino';

const logger = pino({ name: 'owners' });

/** The parts of a signed-in user that the owner allowlist matches on. */
export interface OwnerCandidate {
  sub?: string;
  email?: string;
}

/** Warn-once latch for the empty-allowlist case. See `isOwner`. */
let warnedOpenOwnership = false;

/**
 * Test/maintenance helper: re-arm the empty-allowlist warning.
 * Only exists because the latch below is module-global by design.
 */
export function resetOwnerWarning(): void {
  warnedOpenOwnership = false;
}

/**
 * Authorization, as distinct from authentication.
 *
 * A resolved OIDC session or Portal token only proves CI-Portal vouched for this
 * person. This is a personal device holding one wearer's private memory, so it
 * must serve its OWNER — not "anyone with a valid Portal account". The companion
 * API and the OpenAI facade both check this. `config.auth.owners`
 * (MENTRA_ALLOWED_USERS) is that owner list, matched case-insensitively on
 * email or sub.
 *
 * An EMPTY list allows, because every existing single-user deployment has one
 * and silently locking them all out is worse than the exposure. But it is not
 * silent: we warn once per process so the operator learns the box is open to
 * any Portal user. The warn is latched rather than per-request — a line on
 * every call is noise that gets filtered, not a signal.
 */
export function isOwner(user: OwnerCandidate): boolean {
  const owners = config.auth?.owners ?? [];

  if (owners.length === 0) {
    if (!warnedOpenOwnership) {
      warnedOpenOwnership = true;
      logger.warn(
        { hint: 'Set MENTRA_ALLOWED_USERS to a comma-separated list of owner emails.' },
        'MENTRA_ALLOWED_USERS is not set: ANY user who can sign in to CI-Portal can use this appliance, with full read/write access to this wearer\'s private memory.'
      );
    }
    return true;
  }

  const candidates = [user.email, user.sub]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));

  return candidates.some((value) => owners.includes(value));
}
