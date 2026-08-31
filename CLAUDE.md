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

All the public method should have tsdoc comments which describes all the arguments, all the exceptions thrown by the method, a one line summary of what method does, any remarks if needed and an example. Do these for all new methods and any existing method you update.

Exempt from the above: constructors, and methods whose body is a single statement. Document these only when there is something to say that the signature does not already say — a constraint, a gotcha, a reason. A docstring that restates the name, the parameter names, or the return type is noise; leave it out. The class or function's own docstring still carries the summary.

Always use claude in chrome for verification and debugging

Use router instead of useState for navigating between pages