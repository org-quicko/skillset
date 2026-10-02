# 42. A Resource is identified by Kind, Namespace, and name

## Status

Accepted. Reverses [ADR-0002](0002-overwrite-instead-of-versioning.md) on the one point it
rejected namespacing. Amends [ADR-0026](0026-resource-with-a-kind-and-a-payload.md) on what
identifies a Resource, and the entry shape [ADR-0038](0038-a-lockfile-records-what-was-installed.md)
records. Follows [ADR-0041](0041-a-resource-records-where-it-came-from.md) in how the column is
stored and resolved. Leaves [ADR-0022](0022-install-writes-canonical-and-symlinks.md) untouched.

## Context

ADR-0002 rejected namespacing on a premise it stated plainly: one Registry serves one team, so two
people reaching for the same name is a conversation rather than a conflict. That held while
publishing meant a folder somebody on the team had written.

It has expired twice. Import brought in Skills named by parties who were never on the team —
enough of a change that ADR-0041 added a column to record which repository they came from. The CLI
now publishes from a git URL and installs from one, which turns that from an occasional act
performed in a browser into the ordinary way outside Skills arrive.

`resources_kind_name_unique` is `UNIQUE(kind, name)`, and a publish to an existing name is a full
replace (ADR-0002). Together those mean a `pdf` imported from one repository **silently overwrites**
a `pdf` imported from another. Nothing warns, nothing versions, and the first Skill's files are
gone. That is data loss caused by two strangers picking the same ordinary word, and it gets more
likely with every import surface added.

## Decision

A Resource is identified by `(kind, namespace, name)`.

**Stored on every row, `NOT NULL`, and never resolved on read.** This is what separates a Namespace
from a `source` (ADR-0041): a Source is provenance and may genuinely be absent, where a Namespace is
half of a Resource's identity and never is. An Import is named by the `owner/repo` it was copied out
of; anything published straight here is named by this deployment's own host.

**Forward-DNS, not reverse.** A Namespace reads as `skills.quicko.com` where the same Registry's
Source resolves to `com.quicko.skills`. A Source is only ever linked; a Namespace is read aloud and
typed at a prompt, so it takes the form people already know how to type.

**Derived from the declared `source`, not declared on its own.** The publisher still chooses it — by
choosing what to declare as the Source — but the two cannot disagree, so a Skill copied out of
`github.com/a/b` has no way to claim it was named by `c/d`. One declared field, one derivation, and
no second thing to validate against the first.

**A bare name still reads, whoever named it.** Storing the value does not force the lookup to demand
one. Unqualified, `by-name/{name}` takes the only candidate when there is one, and otherwise the one
published here — so every name that resolved before still resolves, and to the same Skill, and an
Imported Skill nobody competes with is still reachable by the name its author gave it. Only a
genuine tie between two outside parties has no answer, and that refuses with both Namespaces named
rather than guessing.

**Qualification is what installing needs, not what reading needs.** An install writes a directory
that can hold one Skill of a name (ADR-0022), so a tie there has to be resolved by the caller.
Reading has no such constraint, and making it demand a Namespace would have been a cost with nothing
bought. Search is untouched: `GET /resources?q=` has always ranked across the whole catalog and still
does, so a name is as findable as it ever was.

**Opaque throughout**: lowercase alphanumerics, dots, hyphens, and at most one slash, compared
whole and never split. It confers nothing — no ownership, no permission, no claim on a name — and
is never renamed, because a rename re-identifies every Resource beneath it.

**Required for a Skill. An MCP Server has none of its own**, its `name` being reverse-DNS already by
the upstream specification (ADR-0027), so it takes this Registry's.

## Considered Options

**Keep flat names and refuse a colliding publish.** Rejected, and it is the option that looks
cheapest. Refusing means the second publisher cannot publish at all, because the name is held by
somebody who is not on the team and cannot be asked to rename. It converts a naming coincidence
into a permanent block on importing a perfectly good Skill.

**Prefix the name at import — `anthropics-skills-pdf`.** Rejected: `SKILL.md`'s frontmatter is the
source of truth for a Skill's name, and the name is what an agent matches when it decides to load
one. Rewriting it to dodge a uniqueness constraint corrupts the one field that has to stay the
author's.

**Version instead of overwrite, so the second publish is a new version.** Rejected: it reopens
ADR-0002, and it is the wrong shape anyway. Two Skills from two unrelated repositories that happen
to share a word are not versions of one another.

**Leave a first-party Namespace null and resolve it on read**, the way ADR-0041 treats `source`.
Rejected, after being chosen and reversed. It is genuinely cheaper — no backfill for first-party
rows, and no configuration needed inside a migration — but it pays for that by making uniqueness
depend on `UNIQUE NULLS NOT DISTINCT`, three words whose removal silently restores the overwrite
this ADR exists to prevent. It also splits one concept across two representations, so every
comparison has to remember that null and `skills.quicko.com` are the same Namespace. The
non-breaking lookup that was its main attraction turned out not to depend on it at all.

## Consequences

**The backfill is derivable, and only because `source` shipped first.** Imported rows take the
`owner/repo` parsed out of their `source` URL; every other row takes this deployment's host. Had
this landed before ADR-0041 there would have been nothing to derive from and every row would have
needed a human.

GitLab's nested groups do not fit in one slash, so the derivation takes the **last two** path
segments: `group/subgroup/project` becomes `subgroup/project`. Imprecise, and accepted — a Namespace
confers nothing and is never resolved back to an address.

**A migration now needs one piece of deployment configuration.** `PUBLIC_URL`'s host cannot be known
when the SQL is written, so `0006_resource_namespace.sql` carries a second sentinel and
`runMigrations` substitutes it, exactly as it already does for the schema name. The value is checked
against `isNamespace` immediately before substitution, which is the same boundary `readDbSchema` is
for the schema name: a Namespace is lowercase alphanumerics, dots, hyphens and at most one slash,
which leaves nothing a quote could escape into.

**The Namespace follows the Source, including on a republish.** ADR-0041 already has a republish from
disk clearing an earlier Import's Source; deriving from that means it moves the Skill into this
Registry's own Namespace too, rather than leaving it filed under a repository the new bytes did not
come from. The cost is that this is an insert, not an update — the Imported row stays where it is and
the re-published one lands beside it. That is the honest reading of "two parties named this", and it
is the one place where the identity being three columns is visible as a surprise.

**The change is additive for reads.** `GET /resources/skill/by-name/pdf`, `skillset info pdf`, the MCP
tools and the Marketplace document (ADR-0030) all keep working, because an unqualified name resolves
by the rule above rather than demanding a Namespace. What a bare name *means* does shift in one case:
where two outside parties have published it and neither is this Registry, the read now refuses
instead of returning whichever row happened to be there. Nothing could have returned the right one,
so this trades a silent wrong answer for an answerable question.

`install` is the exception on purpose, and the CLI carries it: a bare name matching more than one
Namespace has to be resolved with the caller before a directory is written.

**Installs stay flat, and this does not change that.** ADR-0022 writes `.agents/skills/<name>`, so
a project holds at most one Skill of a given name however many Namespaces publish one. Two
consequences follow for the CLI, and neither is optional: a bare `install <name>` matching more
than one Namespace must disambiguate rather than guess, and an install must refuse when the
directory is already held by a Skill from a different Namespace rather than overwrite it.

Namespace makes two same-named Skills **co-publishable**, not co-installable. Anyone reading this
expecting it to solve the directory collision should stop here: that is a separate refusal in the
CLI, and it stays.
