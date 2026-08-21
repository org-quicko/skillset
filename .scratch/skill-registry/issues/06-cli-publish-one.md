# 06 — Publish one Skill from the CLI

**What to build:** `skillreg` exists, authenticates with a Token, can tell you who and where it is, and publishes a single Skill from the directory you are working in.

**Blocked by:** 03 — Publish a Skill through the API; 05 — Tokens.

**Status:** ready-for-agent

- [ ] The CLI is a buildable, publishable package with the binary name `skillreg`, built against the shared module rather than its own copy of the rules.
- [ ] Logging in stores the Registry location and the Token in a per-User configuration file.
- [ ] Environment variables for the Registry location and the Token override the configuration file, so the same command works in CI with no login step.
- [ ] With neither configuration nor environment present, commands fail with a message explaining how to authenticate.
- [ ] The identity command reports which Registry it is talking to and which User it is authenticated as, so a wrong location is distinguishable from a rejected Token.
- [ ] Publishing from a path holding a `SKILL.md` validates it locally with the same rules the API applies, then creates the row and uploads the Artifact.
- [ ] A local validation failure names the rule and exits without contacting the Registry at all.
- [ ] A reader's Token is refused with a message about permissions rather than a generic failure.
- [ ] Commands are invoked in process against an injected HTTP client and a temporary filesystem in tests, never by spawning a subprocess.
