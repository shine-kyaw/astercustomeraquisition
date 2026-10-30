import { TEAM_NAMES } from './constants'
import type { Session } from './auth'

/**
 * Who may do what. Checked on the server for every protected operation — hiding a button
 * is not access control.
 *
 * Honest limit: while sign-in is a shared password plus a name picked from a list, a role
 * is only as trustworthy as that pick. These checks stop mistakes and set the structure
 * for Google sign-in (roadmap phase P2); they don't stop someone who has the password
 * and chooses to sign in as Shine. Rotating the team password when someone leaves is what
 * actually closes access today.
 */
export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

const ASSIGNED: Record<string, Role> = {
  'Shine Kyaw': 'owner',
}

/**
 * Roster members, and anyone signed in under "Other" (that's why the option exists), work
 * leads as members. Admin operations need an explicit assignment above.
 */
export function roleOf(name: string): Role {
  return ASSIGNED[name] ?? 'member'
}

export function isTeamMember(name: string): boolean {
  return TEAM_NAMES.includes(name)
}

/** Operations that destroy, override or reconfigure, and so need owner or admin. */
export type AdminAction = 'delete' | 'restore' | 'settings' | 'revoke_exclusion' | 'clear_dnc' | 'void_any_event'

export function can(name: string, _action: AdminAction): boolean {
  const role = roleOf(name)
  return role === 'owner' || role === 'admin'
}

/** Throws a 403-shaped error, which guard() turns into a clean response. */
export function requireCan(session: Session, action: Parameters<typeof can>[1]): void {
  if (!can(session.name, action)) {
    const err = new Error('Only Shine (or an admin) can do that.') as Error & { status?: number }
    err.status = 403
    throw err
  }
}
