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
skillset list                # what's installed here, and whether it's current
skillset update [names...]   # re-download whatever the Registry has moved on from
skillset remove <name>       # uninstall a Skill
skillset publish [path]      # defaults to the current directory
skillset whoami
```

Credentials are stored per-Registry after `login`. For CI, skip `login` and set:

```sh
SKILLSET_REGISTRY=<url>
SKILLSET_TOKEN=<token>
```

`SKILLSET_REGISTRY` and `SKILLSET_TOKEN` always override the stored config.

## License

AGPL-3.0-only
