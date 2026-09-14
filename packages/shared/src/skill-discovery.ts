/**
 * How many directory levels below a starting folder a Skill-discovery walk
 * will look, not counting the starting folder itself.
 *
 * @remarks
 * Shared by every walk that looks for more than one Skill under a path — the
 * CLI's local filesystem walk and the shared remote walk over a Git
 * Provider's tree — so "three levels deep" is one number rather than two
 * that could drift apart.
 */
export const SKILL_DISCOVERY_MAX_DEPTH = 3;
