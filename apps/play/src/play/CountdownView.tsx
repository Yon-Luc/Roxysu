import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, Text, colors } from "../components/ui";

type CountdownViewProps = {
  remainingMs: number;
  title: string | null;
};

export function CountdownView({ remainingMs, title }: CountdownViewProps) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get ready</CardTitle>
      </CardHeader>
      <CardContent>
        <StackCenter>
          <Text size="2xl" weight="bold" color={colors.primary}>
            {seconds}
          </Text>
          {title ? (
            <Text size="sm" muted>
              {title}
            </Text>
          ) : null}
        </StackCenter>
      </CardContent>
    </Card>
  );
}

function StackCenter({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}
