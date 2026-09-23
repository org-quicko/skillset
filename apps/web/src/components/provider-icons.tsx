import type { IdentityProviderKind } from "@in-org-quicko/skillset-shared";
import { GithubIcon, GitlabIcon, GoogleIcon, MicrosoftIcon } from "@/components/provider-icon-svgs";

/** Brand icon to show next to each identity provider's login button. */
export const PROVIDER_ICONS: Record<
  IdentityProviderKind,
  (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  google: GoogleIcon,
  github: GithubIcon,
  microsoft: MicrosoftIcon,
};

/**
 * Brand icon to show next to a Git Provider's name, keyed by `GIT_PROVIDERS`
 * rather than {@link IdentityProviderKind} — a Git Provider an Integration
 * reads from is a different set from a login provider, even where a name
 * (`"github"`) happens to appear in both.
 */
export const GIT_PROVIDER_ICONS: Record<
  string,
  (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  github: GithubIcon,
  gitlab: GitlabIcon,
};
