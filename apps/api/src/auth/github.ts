const GITHUB_API = "https://api.github.com";

// GitHub refuses requests without one, and asks that it identify the caller.
const USER_AGENT = "skill-registry";

/**
 * The scopes a GitHub login asks for.
 *
 * @remarks
 * `read:org` is what makes the login gate work at all: without it `/user/orgs`
 * returns an empty list for every member and every login is refused (ADR-0018).
 *
 * `repo` is for importing Skills from private repositories (ADR-0020), and is
 * the one worth knowing about. GitHub does not divide it: it is read *and*
 * write across every private repository the person can reach, with no
 * per-repository narrowing available to an OAuth App. It is requested at login
 * rather than at first import, so everyone signing in with GitHub grants it —
 * including a reader who never imports anything. ADR-0020 records why that
 * trade was taken and what would replace it.
 */
export const GITHUB_SCOPES = ["read:user", "user:email", "read:org", "repo"];

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
 * It is taken as given, verified or not. GitHub's `verified` flag is
 * deliberately not a gate here — see ADR-0018 for what that costs and why
 * membership of the permitted organisation is relied on instead.
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

  return {
    ...user,
    organisations: organisations.map((organisation) => organisation.login.toLowerCase()),
    email: primary?.email ?? user.email ?? null,
  };
}
