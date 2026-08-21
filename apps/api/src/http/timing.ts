/**
 * Pads elapsed time up to a floor so a fast path (unknown email, no hash to
 * verify) takes as long as a slow one (wrong password, argon2id verify run)
 * — otherwise response time itself reveals whether an email is registered.
 */
export async function padTo(startedAt: number, floorMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = floorMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
