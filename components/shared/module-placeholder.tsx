import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Standard "not yet built" placeholder for module pages.
 *
 * Per project workflow, each module goes: 1) feature/use-case list, then
 * 2) test cases, then 3) implementation — all confirmed with the developer
 * before code is written. These routes exist so the app shell/navigation
 * is complete; swap this out once a module's implementation step is signed off.
 */
export function ModulePlaceholder({ moduleName }: { moduleName: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{moduleName}</CardTitle>
          <Badge variant="warning">Pending</Badge>
        </div>
        <CardDescription>
          Route and layout are wired up. Feature list, test cases, and implementation for this
          module haven&apos;t been confirmed yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-neutral-600">
          Next step: confirm the {moduleName} feature &amp; use-case list before writing test cases
          or code.
        </p>
      </CardContent>
    </Card>
  );
}
