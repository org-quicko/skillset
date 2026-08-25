Prefer simple solutions always. Good systems tend to be simple in nature. Channel YAGNI
Use typesafety. Avoid using `any` unless required

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

Don't perform `git add`, `git commit` or `git push`
Don't add unneceesaary comments. Add comments wherever it is required to state a beahviour

All the public method should have jsdoc comments which describes all the arguments, a summary of what method does and an example. Do these for all new methods and any existing method you update.

Always use claude in chrome for verification and debugging

Use router instead of useState for navigating between pages