"use client";

import { useState } from "react";
import { Button, Card, Check, Input, Label, Select, Tag, useAction } from "@/components/ui";
import { api, useLoad } from "@/lib/client";
import { CURRENCIES } from "@/lib/pay";
import type { ApplyFacts, AppSettings } from "@/lib/settings";
import { H, P } from "./bits";
import type { SettingsState } from "./state";

// ---------- answers JobPilot learned ----------

type Learned = { id: string; question: string; answer: string | string[]; scope: string; uses: number; at: number; by?: string };
const SHOWN = 100;
const answerText = (a: Learned) => (Array.isArray(a.answer) ? a.answer.join(", ") : a.answer);

function LearnedTags({ a }: { a: Learned }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <b className="min-w-0 flex-1">{a.question}</b>
      <Tag tone={a.by === "you" ? "good" : undefined}>{a.by === "you" ? "yours" : "AI"}</Tag>
      <Tag>{a.scope === "all" ? "all jobs" : "one job"}</Tag>
      {a.uses ? <Tag tone="good">reused {a.uses}×</Tag> : null}
    </div>
  );
}

function LearnedRow({ a, reload }: { a: Learned; reload: () => Promise<unknown> }) {
  const [edit, setEdit] = useState<string | undefined>(undefined);
  const { busy, run } = useAction();
  const save = () =>
    run(`s${a.id}`, async () => {
      await api("/api/apply/learned", { method: "PATCH", body: { id: a.id, answer: Array.isArray(a.answer) ? edit!.split(/\s*,\s*/) : edit } });
      setEdit(undefined);
      await reload();
      return "Saved";
    });
  const forget = () =>
    run(`d${a.id}`, async () => {
      await api(`/api/apply/learned?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      await reload();
      return "Forgotten";
    });
  return (
    <div className="grid gap-1 border-t border-line pt-2">
      <LearnedTags a={a} />
      <div className="flex gap-2">
        <Input value={edit ?? answerText(a)} onChange={(e) => setEdit(e.target.value)} />
        {edit !== undefined && edit !== answerText(a) ? <Button small variant="primary" busy={busy === `s${a.id}`} onClick={save}>Save</Button> : null}
        <Button small variant="danger" busy={busy === `d${a.id}`} onClick={forget}>Forget</Button>
      </div>
    </div>
  );
}

/** Answers JobPilot remembered from AI replies and from forms you filled yourself: correct or forget any of them. */
function LearnedCard() {
  const { data, reload } = useLoad<{ answers: Learned[] }>("/api/apply/learned");
  const [filter, setFilter] = useState("");
  const needle = filter.toLowerCase();
  const list = (data?.answers ?? []).filter((a) => !filter || a.question.toLowerCase().includes(needle));
  const shown = list.slice(0, SHOWN);
  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H>Answers JobPilot learned ({data?.answers.length ?? 0})</H>
        <Input className="w-56" placeholder="Search questions" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <P>Every answer the AI writes is kept here, so the same question is never sent to the AI again. So is every answer you type or pick yourself on a form: the extension saves it when you press Submit, Next or Continue, and your answers win over the built-in answer bank. Answers written for one job (“Why do you want to work here?”) are only reused for that job. Fix a wrong one here and it is used from then on.</P>
      {shown.map((a) => <LearnedRow key={a.id} a={a} reload={reload} />)}
      {list.length > shown.length ? <P>Showing 100 of {list.length}. Search to find others.</P> : null}
      {data && !data.answers.length ? <P>Nothing yet. After the extension asks the AI something, the answer shows up here.</P> : null}
    </Card>
  );
}

// ---------- your facts ----------

const csv = (a: string[]) => a.join(", ");
const fromCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const DECLINE = "Prefer not to say";

type FactsProps = { f: ApplyFacts; set: (p: Partial<ApplyFacts>) => void };

function FactText({ f, set, k, label, hint, placeholder }: FactsProps & { k: keyof ApplyFacts; label: string; hint?: string; placeholder?: string }) {
  return (
    <Label label={label} hint={hint}>
      <Input value={String(f[k] ?? "")} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<ApplyFacts>)} />
    </Label>
  );
}

function FactToggles({ f, set, k, all }: FactsProps & { k: "workModes" | "employmentTypes"; all: readonly string[] }) {
  const have = f[k] as string[];
  return (
    <div className="flex flex-wrap gap-3">
      {all.map((v) => (
        <Check key={v} label={v} checked={have.includes(v)} onChange={(e) => set({ [k]: e.target.checked ? [...have, v] : have.filter((x) => x !== v) } as Partial<ApplyFacts>)} />
      ))}
    </div>
  );
}

function Money({ f, set, k, label, hint }: FactsProps & { k: "target" | "last" | "floor"; label: string; hint: string }) {
  return (
    <Label label={label} hint={hint}>
      <Input type="number" min={0} value={f.salary[k] || ""} onChange={(e) => set({ salary: { ...f.salary, [k]: Number(e.target.value) || 0 } })} />
    </Label>
  );
}

function Demo({ f, set, k, label, options }: FactsProps & { k: keyof ApplyFacts; label: string; options: string[] }) {
  return (
    <Label label={label}>
      <Select value={String(f[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<ApplyFacts>)}>
        {[...new Set([...options, DECLINE, String(f[k])])].map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </Label>
  );
}

function WhereFacts(p: FactsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FactText {...p} k="city" label="City" placeholder="Islamabad" />
      <FactText {...p} k="region" label="State / province" placeholder="Islamabad Capital Territory" />
      <FactText {...p} k="country" label="Country" placeholder="Pakistan" />
      <FactText {...p} k="postalCode" label="Postal code" hint="Left empty on forms if blank" />
      <FactText {...p} k="address" label="Street address" hint="Left empty on forms if blank" />
      <FactText {...p} k="nationality" label="Nationality" placeholder="Pakistani" />
      <FactText {...p} k="timezone" label="Time zone" placeholder="PKT (UTC+5)" />
      <FactText {...p} k="pronouns" label="Pronouns" placeholder="he/him" />
      <FactText {...p} k="totalYears" label="Total years of experience" placeholder="6" />
    </div>
  );
}

function WorkFacts(p: FactsProps) {
  const { f, set } = p;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Countries you can work in without sponsorship" hint="Comma-separated. Anywhere else, forms are told you need sponsorship.">
          <Input value={csv(f.authorizedCountries)} placeholder="Pakistan" onChange={(e) => set({ authorizedCountries: fromCsv(e.target.value) })} />
        </Label>
        <Label label="Notice period (days)" hint="Start date = today + this">
          <Input type="number" min={0} value={f.noticeDays} onChange={(e) => set({ noticeDays: Number(e.target.value) || 0 })} />
        </Label>
        <FactText {...p} k="languages" label="Languages" placeholder="English (Fluent), Urdu (Native)" />
        <FactText {...p} k="english" label="English level" placeholder="Fluent" />
        <FactText {...p} k="hoursOverlap" label="Working-hours overlap answer" hint="Used when a form asks in words" />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-semibold">Work setups you accept</span>
        <FactToggles {...p} k="workModes" all={["Remote", "Hybrid", "Onsite"]} />
        <span className="text-sm font-semibold">Job types you accept</span>
        <FactToggles {...p} k="employmentTypes" all={["Full-time", "Part-time", "Contract", "Internship"]} />
        <div className="flex flex-wrap gap-4">
          <Check label="Willing to relocate" checked={f.relocate} onChange={(e) => set({ relocate: e.target.checked })} />
          <Check label="Willing to travel" checked={f.travel} onChange={(e) => set({ travel: e.target.checked })} />
        </div>
      </div>
    </>
  );
}

function SalaryFacts(p: FactsProps) {
  const { f, set } = p;
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold">Salary (per month)</span>
      <P>When a job states a range, JobPilot asks for its maximum, but never less than your floor. With no range: your target for jobs in your country, or a competitive market rate (worked out once per role) for jobs abroad. Amounts are converted to the currency and period each form asks for.</P>
      <div className="grid gap-3 sm:grid-cols-4">
        <Label label="Currency">
          <Select value={f.salary.currency} onChange={(e) => set({ salary: { ...f.salary, currency: e.target.value } })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Label>
        <Money {...p} k="target" label="Target" hint="What you ask for" />
        <Money {...p} k="last" label="Current / last" hint="For “current salary”" />
        <Money {...p} k="floor" label="Floor" hint="Never ask below this" />
      </div>
    </div>
  );
}

function DiversityFacts(p: FactsProps) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-semibold">Voluntary diversity questions</span>
      <div className="grid gap-3 sm:grid-cols-4">
        <Demo {...p} k="gender" label="Gender" options={["Male", "Female", "Non-binary"]} />
        <Demo {...p} k="ethnicity" label="Race / ethnicity" options={["Asian", "White", "Black or African American", "Hispanic or Latino", "Middle Eastern", "Two or more races"]} />
        <Demo {...p} k="hispanic" label="Hispanic or Latino" options={["No", "Yes"]} />
        <Demo {...p} k="veteran" label="Veteran" options={["No", "Yes"]} />
        <Demo {...p} k="disability" label="Disability" options={["No", "Yes"]} />
        <Demo {...p} k="orientation" label="Sexual orientation" options={["Heterosexual", "Gay or lesbian", "Bisexual"]} />
        <Demo {...p} k="transgender" label="Transgender" options={["No", "Yes"]} />
      </div>
    </div>
  );
}

/** Your standing facts: the question bank answers from these with no AI. */
function FactsCard({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const f = settings.applyFacts;
  const p: FactsProps = { f, set: (patch) => setSettings({ ...settings, applyFacts: { ...f, ...patch } }) };
  return (
    <Card className="grid gap-4">
      <div>
        <H>Your facts</H>
        <P>The built-in question bank answers about 50 common questions from these (and your CV) without any AI: location, work rights, sponsorship, notice period, start date, salary, years of experience, education, consent boxes, “how did you hear about us”, diversity questions and more. Press Save changes at the top when done.</P>
      </div>
      <WhereFacts {...p} />
      <WorkFacts {...p} />
      <SalaryFacts {...p} />
      <DiversityFacts {...p} />
    </Card>
  );
}

// ---------- your own answers ----------

type Rows = AppSettings["applyAnswers"];

function OwnAnswersCard({ rows, setRows }: { rows: Rows; setRows: (r: Rows) => void }) {
  const setRow = (i: number, p: Partial<Rows[number]>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  return (
    <Card className="grid gap-3">
      <H>Your own answers</H>
      <P>For questions the bank does not cover. A question here matches the same question worded differently on a form (“Expected salary” also answers “What is your expected salary?”).</P>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <Label label={i === 0 ? "Question" : ""}><Input value={r.question} onChange={(e) => setRow(i, { question: e.target.value })} placeholder="Do you have a driving licence?" /></Label>
          <Label label={i === 0 ? "Your answer" : ""}><Input value={r.answer} onChange={(e) => setRow(i, { answer: e.target.value })} placeholder="Leave empty to fill this one yourself each time" /></Label>
          <Button small variant="danger" onClick={() => setRows(rows.filter((_, n) => n !== i))}>Remove</Button>
        </div>
      ))}
      <div><Button small onClick={() => setRows([...rows, { question: "", answer: "" }])}>+ Add answer</Button></div>
    </Card>
  );
}

export function ApplySection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  return (
    <div className="grid gap-4">
      <Card className="grid gap-2">
        <H>How the extension answers a form</H>
        <P>For each empty field, in this order: <b>1.</b> your CV (name, email, phone, links) → <b>2.</b> the question bank, using your facts below → <b>3.</b> your own answers → <b>4.</b> answers it learned earlier → <b>5.</b> the AI, only for what is still unanswered. Short questions go to the cheap model; open questions get 1–3 sentences, 60 words at most. Every AI answer is saved, so it is asked once.</P>
      </Card>
      <FactsCard state={state} />
      <OwnAnswersCard rows={settings.applyAnswers} setRows={(applyAnswers) => setSettings({ ...settings, applyAnswers })} />
      <LearnedCard />
      <Card className="grid gap-2">
        <H>Browser extension</H>
        <P>The extension lives in the <code>extension</code> folder of this project. In Chrome open <code>chrome://extensions</code>, switch on Developer mode, press “Load unpacked” and choose that folder. Then open a job post from the Jobs board, start the application and press the JobPilot icon → “Fill this page”. It fills the fields; you check them and press Submit yourself.</P>
      </Card>
    </div>
  );
}
