# 02 — First Admin and sessions

**What to build:** The first person to reach a fresh Registry signs up and becomes an Admin, and the signup door closes behind them. After that, Users log in and out, and the Registry knows who they are and what role they hold on every single request.

**Blocked by:** 01 — Walking skeleton.

**Status:** ready-for-agent

- [ ] Signup succeeds only while no User exists, and the User it creates is an Admin.
- [ ] Once any User exists, signup is unavailable to everyone, authenticated or not.
- [ ] A User logs in with email and password and receives a session cookie that is http-only, secure, and strictly same-site.
- [ ] A failed login does not reveal whether the email is known — same response either way, and the response time is padded to a floor so timing does not reveal it either.
- [ ] The session carries only the User's identifier — never their role.
- [ ] The role is read from the database on every request, so changing a User's role takes effect on their very next request with no re-login.
- [ ] Logging out ends the session.
- [ ] A route reports the authenticated User's identity, names, and role.
- [ ] Passwords are stored with the runtime's built-in argon2id, and plaintext is never persisted or logged.
- [ ] A User may exist with no password at all; nothing assumes that a User implies a password (ADR-0007).
- [ ] Issuing a session takes an already-resolved User rather than a set of credentials, so adding a second way to log in later is a new route and nothing more.
- [ ] Authentication resolves a request to a User without regard to which credential produced it; authorisation reads the role separately, on that request.
- [ ] The closed-signup test asserts that the initialisation route is unavailable once a User exists — not that only an Admin can create Users, which OIDC will make false.
- [ ] The web interface shows a bootstrap signup screen while the Registry has no Users, and a login screen once it does.
- [ ] An unauthenticated response from any route returns the User to login and discards cached server state.
