# @in-org-quicko/skillset-cli

Command-line client for publishing and managing Skills on a [Skillset](https://github.com/org-quicko/skillset) Registry.

## Install

```sh
npm install -g @in-org-quicko/skillset-cli
```

This installs a `skillset` binary.

## Usage

```sh
skillset login --registry <url>
skillset search [query]      # what the team has published
skillset info <name>         # read a Skill without installing it
skillset install <name>      # install a Skill for a coding agent
skillset install <url> --name <skill>  # install straight from a GitHub or GitLab repo
skillset list                # what's installed here, and whether it's current
skillset update [names...]   # re-download whatever the Registry has moved on from
skillset remove <name>       # uninstall a Skill
skillset publish [path]      # defaults to the current directory
skillset publish <url> --name <skill>  # publish straight from a GitHub or GitLab repo
skillset whoami
```

Without a global install, every command runs through `npx`:

```sh
npx @in-org-quicko/skillset-cli install <name>
```

## Namespaces

Two parties can publish the same Skill name — the team's own `pdf` and one imported from
`anthropics/skills`. A bare name still reads: it resolves to the only match, or to the one
published to your Registry. Only a tie between two outside parties has to be spelled out.

```sh
skillset search pdf                             # imported rows show their namespace
skillset install pdf                            # yours, or the only one
skillset install pdf --namespace anthropics/skills
```

A project holds one `.agents/skills/<name>`, so installing a Skill over one a *different* party
named is refused; pass `--force` to replace it.

## Installing from a repository

```sh
skillset install https://github.com/acme/skills --name pdf
skillset install https://github.com/acme/skills/tree/main/pdf --name pdf   # or a folder in it
```

The CLI clones the repository with **your own git**, so any repository you can clone works —
private ones included, over HTTPS or SSH, with whatever credentials git already has. It needs git
on `PATH`. `--name` is required: it picks the Skill by the `name` in its `SKILL.md`.

The Skill is recorded in `skillset-lock.json` with the repository it came from. If you are logged
in, it is also submitted to the Registry for an Admin to approve (Settings → Submissions). Until
then `skillset update` reports it as pending; once approved, `update` switches it to the
Registry's copy.

## Publishing from a repository

```sh
skillset publish https://github.com/acme/skills --name pdf
```

Exactly like `install <url>`: the repository is cloned with **your own git**, so private ones
work too, and `--name` (required) picks the Skill by the `name` in its `SKILL.md`. The Skill
records the repository as its Source, and takes its Namespace from it. A Skill published from a
path records no Source and reads as published straight to your Registry.

Credentials are stored per-Registry after `login`. For CI, skip `login` and set:

```sh
SKILLSET_REGISTRY=<url>
SKILLSET_TOKEN=<token>
```

`SKILLSET_REGISTRY` and `SKILLSET_TOKEN` always override the stored config.

## Machine-readable output

Every command takes `--json`, which replaces the formatted output with the command's result on
stdout:

```sh
skillset search code-review --json | jq -r '.items[].name'
skillset list --json | jq '[.skills[] | select(.status == "outdated")]'
```

Failures go to **stderr** as `{ "error": { "code, message, status?, field? } }` with a non-zero
exit code, so a pipeline only ever parses well-formed payloads. `code` is the Registry's own
error code where there is one, and `cli_error` for a failure that never reached it.

`--json` never prompts, whatever the terminal says — a clack prompt would write to the same
stdout the payload goes to. So `login` needs `--token`, a multi-Skill `publish` needs `--yes`,
and `install` needs `--agent`/`--scope` where it would otherwise have asked.

## License

AGPL-3.0-only
