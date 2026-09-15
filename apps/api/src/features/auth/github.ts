const GITHUB_API = "https://api.github.com";

// GitHub refuses requests without one, and asks that it identify the caller.
const USER_AGENT = "sqillset";

/**
 * The scopes a GitHub login asks for.
 *
 * @remarks
 * Identity, and nothing else. `read:org` is what makes the login gate work at
 * all: without it `/user/orgs` returns an empty list for every member and every
 * login is refused (ADR-0018).
 *
 * `repo` used to be here, so that a login could double as the credential for
 * importing from a private repository. It is gone: repository access now comes
 * from a **Connection** granted against a separate GitHub App, which asks for
 * `contents: read` on repositories an owner selected rather than read *and*
 * write across everything the person can reach (ADR-0024). A reader who only
 * browses the catalogue no longer grants anything at all.
 *
 * Two things about that removal are true and must not be overclaimed. Scopes
 * **accumulate** on a GitHub OAuth App, so anyone who already granted `repo`
 * keeps receiving `repo`-capable tokens here whatever this list says — which is
 * exactly why the login's token is no longer stored (see the account hook in
 * `createAuth`). And the grants already given cannot be withdrawn from this
 * side: `DELETE /applications/{client_id}/grant` revokes the whole
 * authorization and would face every existing user with a fresh consent screen
 * at their next sign-in.
 */
export const GITHUB_SCOPES = ["read:user", "user:email", "read:org"];

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  /** Only the *public* address, and null for anyone who keeps theirs private. */
  email: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  /** Reported by GitHub and deliberately not gated on here (ADR-0018). */
  verified: boolean;
}

interface GitHubOrganisation {
  login: string;
}

/**
 * A GitHub profile enriched with the two things its `/user` response does not
 * carry but the gate needs: the organisations this account belongs to, and
 * whether the address being asserted is one GitHub has actually verified.
 */
export interface GitHubIdentity extends GitHubUser {
  /** Lowercased organisation logins, for a case-insensitive comparison. */
  organisations: string[];
  /** The account's primary address, or null if it reports none. */
  email: string | null;
  /**
   * Whether GitHub has challenged that address. Not a gate on who gets an
   * account — ADR-0018 leaves that to organisation membership — but it does
   * decide whether this login may attach itself to a User that already exists.
   */
  email_verified: boolean;
}

async function githubGet<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub ${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Reads everything a GitHub login is judged on, in one place.
 *
 * @remarks
 * The address comes from `/user/emails` rather than from `/user`, because the
 * one on the profile is only whatever the account chose to make public and is
 * null for anyone who keeps it private. `/user/emails` reports the primary
 * address whether or not it is public, which is the address the person
 * actually uses.
 *
 * It is taken as given, verified or not, so far as *getting an account* goes:
 * GitHub's `verified` flag is deliberately not a gate here — see ADR-0018 for
 * what that costs and why membership of the permitted organisation is relied on
 * instead. The flag is still reported, because attaching this login to a User
 * that already exists is a different question from creating one, and an
 * unverified address is not an argument for the former.
 *
 * A private membership is still returned, because the token belongs to the
 * member themselves. An organisation that restricts third-party application
 * access is the case that bites: until an owner approves the OAuth app,
 * `/user/orgs` comes back empty for everyone and every login is refused.
 *
 * @param accessToken - The access token from the completed OAuth exchange.
 * @returns The profile, its primary address, and its organisations.
 * @throws Error if any of the three GitHub calls does not return 2xx.
 * @example
 * ```ts
 * const identity = await fetchGitHubIdentity(tokens.accessToken);
 * if (!identity.organisations.includes("acme")) refuse();
 * ```
 */
export async function fetchGitHubIdentity(accessToken: string): Promise<GitHubIdentity> {
  const [user, emails, organisations] = await Promise.all([
    githubGet<GitHubUser>("/user", accessToken),
    githubGet<GitHubEmail[]>("/user/emails", accessToken),
    githubGet<GitHubOrganisation[]>("/user/orgs", accessToken),
  ]);

  const primary = emails.find((candidate) => candidate.primary);
  const email = primary?.email ?? user.email ?? null;

  return {
    ...user,
    organisations: organisations.map((organisation) => organisation.login.toLowerCase()),
    email,
    // Only the primary address carries a flag we read. Falling back to `/user`'s
    // public address means falling back to an address GitHub told us nothing
    // about, which is not a verified one.
    email_verified: email !== null && email === primary?.email && primary.verified,
  };
}
