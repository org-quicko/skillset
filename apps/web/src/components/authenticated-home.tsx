import type { User } from "@skill-registry/shared";
import { SkillsPanel } from "@/components/skills-panel";

export function AuthenticatedHome({ user }: { user: User }) {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <SkillsPanel role={user.role} />
    </div>
  );
}
