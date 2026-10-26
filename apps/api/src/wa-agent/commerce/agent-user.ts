import type { AgentUserRow } from "./agent-commerce.repo.js";
import type { AuthenticatedUser } from "../../common/current-user.js";

/**
 * The caller identity the web services expect, built for the account a chat is linked to. It carries
 * no roles, permissions or organizations: the agent acts as the plain customer, nothing more, and
 * the session fields are placeholders no service of the paid tools reads.
 */
export function agentUser(row: AgentUserRow, now: Date): AuthenticatedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: [],
    permissions: [],
    isSuperAdmin: false,
    orgIds: [],
    twoFactorEnabled: false,
    emailVerified: row.emailVerified,
    phoneVerified: row.phoneVerified,
    session: { id: "wa-agent", createdAt: now, reauthAt: new Date(0), mfaVerifiedAt: null },
  };
}
