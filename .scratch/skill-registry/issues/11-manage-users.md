# 11 — Manage Users

**What to build:** An Admin runs the team — creating Users, changing roles, removing people. A new User must change the password they were handed, and everyone can maintain their own details.

**Blocked by:** 02 — First Admin and sessions.

**Status:** ready-for-agent

- [ ] An Admin creates a User with first name, last name, email, and role, and is shown a generated initial password once.
- [ ] The new User is required to change that password before they can do anything else, and changing it clears the requirement.
- [ ] Any User can change their own password at any time, without an Admin.
- [ ] Any User can correct their own first and last name.
- [ ] An Admin changes another User's role, and it takes effect on that User's next request.
- [ ] An Admin removes a User, ending their access; Skills that User published remain, with their publisher still recorded.
- [ ] The last Admin cannot be demoted or removed, whoever attempts it and by whichever route.
- [ ] User management is refused to readers and writers.
- [ ] Email addresses are unique, and creating a duplicate is refused with a reason that says so.
