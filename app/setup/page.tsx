"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ConnectionsSection, ProfileSection, SearchSection, useSettings,
} from "@/components/settings/sections";
import { Button, Card, Notice, useAction } from "@/components/ui";
import { api } from "@/lib/client";

const STEPS = [
  { title: "Connect your accounts", sub: "Your own Claude, Apify and Gmail. Keys stay on this computer." },
  { title: "Your CV", sub: "Upload it once. Every tailored CV is built only from what is in here." },
  { title: "What to look for", sub: "Job titles and places. You can change these any time." },
] as const;

export default function SetupPage() {
  const state = useSettings();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const { busy, run } = useAction();

  if (state.error) return <Notice title="Could not load" tone="bad">{state.error}</Notice>;
  if (!state.settings || !state.profile) return <Notice title="Loading…" />;
  const { settings, profile } = state;

  const problem =
    step === 1 && (!profile.name.trim() || !profile.email.trim() || !profile.experience.length)
      ? "Add your name, email and at least one job."
      : step === 2 && (!settings.search.titles.filter((t) => t.trim()).length || !settings.search.locations.filter((l) => l.label && l.linkedin).length)
        ? "Add at least one job title and one location with a label and LinkedIn location."
        : null;

  const next = () =>
    run("next", async () => {
      const last = step === STEPS.length - 1;
      await state.save({ settings: { ...settings, setupDone: last ? true : settings.setupDone }, profile });
      if (!last) {
        setStep(step + 1);
        window.scrollTo({ top: 0 });
        return;
      }
      await api("/api/runs", { body: { kind: "find" } }).catch(() => {});
      router.push("/");
      return "Setup saved. The first search has started.";
    });

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 pt-4">
      <header className="grid gap-1">
        <span className="text-sm font-extrabold tracking-tight text-accent">JobPilot setup · step {step + 1} of {STEPS.length}</span>
        <h1 className="text-2xl font-extrabold tracking-tight">{STEPS[step].title}</h1>
        <p className="text-muted">{STEPS[step].sub}</p>
        <div className="mt-2 flex gap-1.5">
          {STEPS.map((s, i) => <span key={s.title} className={"h-1.5 flex-1 rounded-full " + (i <= step ? "bg-accent" : "bg-sunk")} />)}
        </div>
      </header>

      {step === 0 ? <ConnectionsSection state={state} /> : null}
      {step === 1 ? <ProfileSection state={state} /> : null}
      {step === 2 ? <SearchSection state={state} /> : null}

      <Card className="sticky bottom-3 flex flex-wrap items-center gap-2">
        {step ? <Button onClick={() => setStep(step - 1)}>Back</Button> : null}
        <span className="flex-1 text-sm text-warn">{problem}</span>
        <Button variant="primary" busy={busy === "next"} disabled={!!problem} onClick={next}>
          {step === STEPS.length - 1 ? "Finish and find jobs" : "Save and continue"}
        </Button>
      </Card>
    </div>
  );
}
