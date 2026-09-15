# @in-org-quicko/sqillset-cli

Command-line client for publishing and managing Skills on a [Sqillset](https://github.com/org-quicko/sqillset) Registry.

## Install

```sh
npm install -g @in-org-quicko/sqillset-cli
```

This installs a `sqillset` binary.

## Usage

```sh
sqillset login --registry <url>
sqillset publish [path]      # defaults to the current directory
sqillset add <name>          # install a Skill for a coding agent
sqillset whoami
```

Credentials are stored per-Registry after `login`. For CI, skip `login` and set:

```sh
SQILLSET_REGISTRY=<url>
SQILLSET_TOKEN=<token>
```

`SQILLSET_REGISTRY` and `SQILLSET_TOKEN` always override the stored config.

## License

AGPL-3.0-only
