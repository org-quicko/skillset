import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** How much a Skill has actually been used — a download today, and eventually a CLI install too. */
export function SkillAnalyticsCard({ installs }: { installs: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {installs} {installs === 1 ? "install" : "installs"}
        </p>
      </CardContent>
    </Card>
  );
}
