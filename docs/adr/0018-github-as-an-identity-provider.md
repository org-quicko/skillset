# GitHub As An Identity Provider

GitHub joins Google and Microsoft as a Provider kind, reversing ADR-0015's deferral. A login through
it is admitted only if the account is a member of the Provider's configured GitHub organisation.

> **Superseded in part by ADR-0021** on two points below. The gate is now a *list* of permitted
> organisations rather than one, and it may be left empty — in which case no membership check runs
> at all, and the sentence below about a GitHub Provider being unenablable without an organisation
> no longer holds. The reasoning for why the gate matters is unchanged and still worth reading; what
> changed is that an operator may now decline it deliberately. ADR-0021 also reverses the coarse
> refusal message, precisely because the `/user/orgs` gotcha recorded below was indistinguishable
> from ordinary non-membership.

> **Amended.** As first written this also required the email to be one GitHub had verified, and the
> "Considered Options" below reject membership-alone on exactly that ground. That requirement was
> since dropped — for every kind, not only GitHub — and the last entry under Consequences records
> what changed, what it costs, and the bet being made. The argument below is left standing rather
> than rewritten, because it is the case against the decision that was ultimately taken and a reader
> weighing this later should see it made properly.

## Considered Options

**Leaving it deferred**, as ADR-0015 did. That deferral rested on a specific technical claim: GitHub
"publishes none and issues no ID token, so it needs OAuth2 plus a `GET /user` call and an
org-membership gate — a second implementation wearing the same button." The claim was correct and is
now irrelevant, because Better Auth ships that implementation (ADR-0016). What remains ours is the
org gate, which is a single API call.

**Gating on organisation membership alone.** Rejected, and this is the important one. Anyone can
create a GitHub account and set any address on it; GitHub only marks an address verified once it has
proved control. Since ADR-0015 keys identity on the verified email, an unverified address would let
an org member sign in claiming a colleague's address and land in that colleague's account. Membership
answers "should this person have an account here"; the verified flag answers "is this person who the
email says". Both questions have to be answered.

**Gating on the email's domain**, as Google's `hd` effectively does. Rejected: GitHub accounts carry
personal addresses at least as often as corporate ones, so a domain gate would lock out exactly the
colleagues an org gate is meant to admit.

## Consequences

**The OAuth app needs `read:org`.** An operator gotcha follows that is worth writing down before
someone loses an afternoon to it: in an organisation with third-party application access
restrictions enabled, the OAuth app must be approved by an org owner, or `/user/orgs` returns
nothing for every member and every login is refused with no obvious cause. Private membership is
fine — the token is the member's own — but org approval is not optional.

**ADR-0015's standing warning sharpens.** It notes that "every enabled Provider can log into every
account", and that this is "safe only while every Provider is a tenant we control", naming GitHub as
the case that would break it. That is still true, and the org gate is precisely what makes GitHub a
tenant we control rather than the open internet. It is not defence in depth. It is the door, and it
is the reason a GitHub Provider cannot be enabled without an organisation set.

**`permitted_domain` is renamed `permitted_organisation`.** It holds a Workspace domain for Google, a
tenant id for Microsoft, and an organisation login for GitHub; "domain" was already loose for
Microsoft and is simply wrong for GitHub. CONTEXT.md already describes a Provider as vouching for
"the organisation that address belongs to", so the column now matches the glossary.

**The gate is no longer uniformly a claim.** ADR-0015 was able to say the gate is "matched on the
claim, never on the email's suffix", because both Providers put the organisation in the ID token.
GitHub has no ID token, so its gate is a live API call to `/user/orgs` instead. The principle holds —
never infer the organisation from the email address — but the mechanism is now per-kind, and the
per-request cost of a GitHub login is one extra HTTP call.

**The gate runs on every login, not only the first.** Better Auth's `validateUserInfo` is what
makes this true rather than aspirational: it fires on `create-user`, `link-account`, *and*
`sign-in`, and on that third action it is handed the provider's fresh profile rather than the stored
row — which is exactly the case that matters. Someone removed from the GitHub organisation, or moved
out of the Workspace domain, is refused on their next login rather than keeping an account because
they passed the check once. A gate that only ran at account creation would satisfy the wording of
ADR-0015's domain rule while missing its intent.

**Email verification is not checked, for any kind, and the organisation is the whole gate.** This
amends the decision at the top of this ADR, which required a verified address as well as
membership. Two things drove it.

For Google and Microsoft the check was redundant: `hd` and `tid` already prove the token was issued
for the permitted tenant, and inside a tenant the address is provisioned by its administrator, so
the tenant is what makes the address theirs. Entra does not emit `email_verified` at all, so
requiring it refused every Microsoft login outright.

For GitHub it was not redundant, and dropping it is a deliberate acceptance of risk rather than a
tidying-up. GitHub's `verified` flag was doing real work that no claim replaces: anyone may put any
address on a GitHub account, so a member of the permitted organisation can now set their primary
address to a colleague's and sign in as that colleague — the Superadmin included, since ADR-0015
keys identity on email. What stands between that and an outsider is organisation membership alone.
The bet is that membership of a GitHub organisation is itself a controlled, audited thing, and that
a colleague already inside it is not the threat being defended against. That bet is the reason to
keep the organisation tightly held, and the reason this paragraph exists rather than the change
being made quietly.

The address is still read from `/user/emails` rather than `/user`, which is not about verification:
the profile address is only the *public* one and is null for anyone who keeps theirs private, so it
would fail for exactly the people most likely to be members.
