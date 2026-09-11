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
skillset publish [path]      # defaults to the current directory
skillset add <name>          # install a Skill for a coding agent
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
