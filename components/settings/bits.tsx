"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/client";

export const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
export const H = ({ children }: { children: ReactNode }) => <h2 className="text-base font-bold">{children}</h2>;
export const P = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted">{children}</p>;
export const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">{children}</a>
);

type TestResult = { ok: boolean; message: string };

/** Runs `before` (usually a save), then the server-side test for `target`, then `after`. */
async function runTest(target: string, before?: () => Promise<void>, after?: () => unknown): Promise<TestResult> {
  try {
    if (before) await before();
    const result = await api<TestResult>("/api/settings/test", { body: { target } });
    await after?.();
    return result;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Test failed." };
  }
}

export function TestButton({ target, before, after }: { target: string; before?: () => Promise<void>; after?: () => unknown }) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    setResult(null);
    setResult(await runTest(target, before, after));
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button small busy={busy} onClick={test}>
        Save & test
      </Button>
      {result ? <span className={"text-xs font-semibold " + (result.ok ? "text-good" : "text-bad")}>{result.message}</span> : null}
    </div>
  );
}
