import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A placeholder until the Registry actually counts installs — never a fabricated zero. */
export function SkillAnalyticsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">Installs aren&apos;t tracked yet.</p>
      </CardContent>
    </Card>
  );
}
