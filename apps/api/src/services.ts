import type { Database } from "./db/client.js";
import { AnalyticsService } from "./features/analytics/analytics.service.js";
import { Authenticator } from "./features/auth/authenticator.js";
import { createAuthRegistry, type AuthRegistry } from "./features/auth/instance.js";
import { ConnectionsService } from "./features/connections/connections.service.js";
import { IdentityProvidersService } from "./features/identity-providers/identity-providers.service.js";
import { ImportsService } from "./features/imports/imports.service.js";
import { IntegrationsService } from "./features/integrations/integrations.service.js";
import { ResourcesService } from "./features/resources/resources.service.js";
import { SetupService } from "./features/setup/setup.service.js";
import { TagsService } from "./features/tags/tags.service.js";
import { UsersService } from "./features/users/users.service.js";
import type { Logger } from "./lib/logger.js";
import type { StorageAdapter } from "./storage/types.js";

export interface ServiceDependencies {
  db: Database;
  storage: StorageAdapter;
  logger: Logger;
  /** Better Auth's signing secret, also the key Connection tokens are encrypted under. */
  betterAuthSecret: string;
  publicUrl: string;
}

/** Every service the routes use, each constructed exactly once. */
export interface Services {
  /** The Better Auth instance, rebuilt when a Provider's credentials change (ADR-0019). */
  auth: AuthRegistry;
  authenticator: Authenticator;
  analytics: AnalyticsService;
  tags: TagsService;
  resources: ResourcesService;
  users: UsersService;
  setup: SetupService;
  identityProviders: IdentityProvidersService;
  integrations: IntegrationsService;
  connections: ConnectionsService;
  imports: ImportsService;
}

/**
 * Constructs every service, wiring each to the ones it depends on.
 *
 * @remarks
 * The composition root: nothing else constructs a service, so each one is
 * shared by every route that uses it — one Better Auth instance for the whole
 * app, in particular, so a Provider edit rebuilds it once.
 *
 * @param deps - The database, storage adapter, logger, signing secret, and public URL.
 * @returns The services, keyed by name.
 * @example
 * ```ts
 * const services = buildServices({ db, storage, logger, betterAuthSecret, publicUrl });
 * ```
 */
export function buildServices(deps: ServiceDependencies): Services {
  const auth = createAuthRegistry({
    db: deps.db,
    secret: deps.betterAuthSecret,
    publicUrl: deps.publicUrl,
    logger: deps.logger,
  });
  const analytics = new AnalyticsService(deps.db, deps.logger);
  const tags = new TagsService(deps.db, deps.logger);
  const integrations = new IntegrationsService(deps.db, deps.logger);
  const connections = new ConnectionsService(deps.db, deps.betterAuthSecret, deps.logger, integrations);

  return {
    auth,
    authenticator: new Authenticator(deps.db, auth),
    analytics,
    tags,
    resources: new ResourcesService(deps.db, deps.storage, deps.logger, tags, analytics),
    users: new UsersService(deps.db, deps.logger),
    setup: new SetupService(deps.db, deps.logger),
    identityProviders: new IdentityProvidersService(deps.db, deps.logger),
    integrations,
    connections,
    imports: new ImportsService(deps.logger, integrations, connections),
  };
}
