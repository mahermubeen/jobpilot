"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card, Check, Input, Label, Select, Tag, Textarea, useAction } from "@/components/ui";
import { api, useLoad } from "@/lib/client";
import type { Profile } from "@/lib/cv/types";
import { CURRENCIES } from "@/lib/pay";
import type { AppSettings, SearchLocation, Secrets } from "@/lib/settings";

type SecretStatus = {
  anthropicKey: boolean; apifyToken: boolean; gmailUser: string; gmailAppPassword: boolean; apolloKey: boolean;
};
type Loaded = { settings: AppSettings; secrets: SecretStatus; profile: Profile; profileReady: boolean };

/** Loads settings once and keeps editable copies; `save` writes one part back. */
export function useSettings() {
  const { data, error, reload } = useLoad<Loaded>("/api/settings");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Copy the saved values into editable state once, when they first arrive.
  if (data && !seeded) {
    setSeeded(true);
    setSettings(data.settings);
    setProfile(data.profile);
  }

  const save = useCallback(
    async (part: { settings?: AppSettings; profile?: Profile; secrets?: Partial<Secrets> }) => {
      await api("/api/settings", { method: "PUT", body: part });
      await reload();
    },
    [reload],
  );

  return { data, error, settings, setSettings, profile, setProfile, save };
}

export type SettingsState = ReturnType<typeof useSettings>;

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-base font-bold">{children}</h2>;
const P = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted">{children}</p>;
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">{children}</a>
);

// ---------- connections ----------

function TestButton({ target, before }: { target: string; before?: () => Promise<void> }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        small
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            if (before) await before();
            setResult(await api<{ ok: boolean; message: string }>("/api/settings/test", { body: { target } }));
          } catch (e) {
            setResult({ ok: false, message: e instanceof Error ? e.message : "Test failed." });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save & test
      </Button>
      {result ? <span className={"text-xs font-semibold " + (result.ok ? "text-good" : "text-bad")}>{result.message}</span> : null}
    </div>
  );
}

export function ConnectionsSection({ state }: { state: SettingsState }) {
  const { data, settings, setSettings, save } = state;
  const [secrets, setSecrets] = useState<Partial<Secrets>>({});
  if (!data || !settings) return null;
  const s = data.secrets;
  const sec = (k: keyof Secrets) => ({
    value: secrets[k] ?? "",
    onChange: (e: { target: { value: string } }) => setSecrets((x) => ({ ...x, [k]: e.target.value })),
  });
  const saveAll = async () => {
    await save({ settings, secrets });
    setSecrets({});
  };
  const saved = (ok: boolean) => (ok ? <Tag tone="good">Saved</Tag> : <Tag tone="warn">Not set</Tag>);

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Claude (writes emails, tailors your CV, scores jobs)</H></div>
        <div className="grid gap-2">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="ai" className="mt-1 accent-[var(--accent)]" checked={settings.ai.mode === "claude-cli"} onChange={() => setSettings({ ...settings, ai: { ...settings.ai, mode: "claude-cli" } })} />
            <span><b>Use Claude Code on this computer</b><br /><span className="text-sm text-muted">No key needed. Uses the <code>claude</code> command you are already signed in to.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name="ai" className="mt-1 accent-[var(--accent)]" checked={settings.ai.mode === "anthropic"} onChange={() => setSettings({ ...settings, ai: { ...settings.ai, mode: "anthropic" } })} />
            <span><b>Use an Anthropic API key</b><br /><span className="text-sm text-muted">For computers without Claude Code. Pay per use. Get a key at <A href="https://console.anthropic.com/settings/keys">console.anthropic.com</A>.</span></span>
          </label>
        </div>
        {settings.ai.mode === "anthropic" ? (
          <Label label="Anthropic API key" hint={s.anthropicKey ? "A key is saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="sk-ant-…" {...sec("anthropicKey")} />
          </Label>
        ) : null}
        <TestButton target="ai" before={saveAll} />
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Apify (finds jobs and company contacts)</H>{saved(s.apifyToken)}</div>
        <P>Create a free account at <A href="https://console.apify.com/sign-up">apify.com</A>, then copy your token from <A href="https://console.apify.com/settings/integrations">Settings → API &amp; Integrations</A>. The free plan includes about $5 of usage a month.</P>
        <Label label="Apify API token" hint={s.apifyToken ? "A token is saved. Leave blank to keep it." : undefined}>
          <Input type="password" autoComplete="off" placeholder="apify_api_…" {...sec("apifyToken")} />
        </Label>
        <TestButton target="apify" before={saveAll} />
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Gmail (sends your applications, spots replies)</H>{saved(!!s.gmailUser && s.gmailAppPassword)}</div>
        <P>Turn on 2-Step Verification for your Google account, then create an app password at <A href="https://myaccount.google.com/apppasswords">myaccount.google.com/apppasswords</A>. It is 16 letters and only works for mail.</P>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Gmail address"><Input type="email" autoComplete="off" placeholder={s.gmailUser || "you@gmail.com"} {...sec("gmailUser")} /></Label>
          <Label label="App password" hint={s.gmailAppPassword ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="abcd efgh ijkl mnop" {...sec("gmailAppPassword")} />
          </Label>
        </div>
        <TestButton target="gmail" before={saveAll} />
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Apollo (optional: named people and verified emails)</H>{saved(s.apolloKey)}</div>
        <P>Without Apollo, JobPilot uses emails published on company websites. With an <A href="https://app.apollo.io/#/settings/integrations/api">Apollo API key</A> it also looks up founders and recruiters. Each revealed email uses one Apollo credit (two people per company at most).</P>
        <Label label="Apollo API key" hint={s.apolloKey ? "A key is saved. Leave blank to keep it." : undefined}>
          <Input type="password" autoComplete="off" {...sec("apolloKey")} />
        </Label>
        <TestButton target="apollo" before={saveAll} />
      </Card>
    </div>
  );
}

// ---------- search ----------

const newLocation = (): SearchLocation => ({ label: "", linkedin: "", indeedCountry: "", indeedLocation: "", remote: false });

export function SearchSection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const search = settings.search;
  const patch = (p: Partial<AppSettings["search"]>) => setSettings({ ...settings, search: { ...search, ...p } });
  const setLoc = (i: number, p: Partial<SearchLocation>) =>
    patch({ locations: search.locations.map((l, n) => (n === i ? { ...l, ...p } : l)) });
  const searches = search.titles.length * search.locations.length;

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Job titles</H>
        <Label label="One per line" hint="Each title is searched in each location below.">
          <Textarea value={search.titles.join("\n")} onChange={(e) => patch({ titles: e.target.value.split("\n") })} onBlur={(e) => patch({ titles: lines(e.target.value) })} placeholder={"Full Stack Engineer\nReact Native Developer"} />
        </Label>
        <Label label="Skip titles containing (comma separated)">
          <Input value={search.excludeTitleWords.join(", ")} onChange={(e) => patch({ excludeTitleWords: e.target.value.split(",").map((w) => w.trim()).filter(Boolean) })} />
        </Label>
      </Card>

      <Card className="grid gap-3">
        <H>Locations</H>
        <P>“LinkedIn location” is what you would type in LinkedIn’s location box. For Indeed, give the two-letter country site (US, GB is UK, PK, AE, CA…) and optionally a city. Leave the Indeed country empty to skip Indeed for that row.</P>
        {search.locations.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.2fr_1.2fr_0.6fr_1fr_auto_auto] sm:items-end">
            <Label label="Label on cards"><Input value={l.label} onChange={(e) => setLoc(i, { label: e.target.value })} placeholder="Worldwide remote" /></Label>
            <Label label="LinkedIn location"><Input value={l.linkedin} onChange={(e) => setLoc(i, { linkedin: e.target.value })} placeholder="Worldwide" /></Label>
            <Label label="Indeed country"><Input value={l.indeedCountry} maxLength={2} onChange={(e) => setLoc(i, { indeedCountry: e.target.value.toUpperCase() })} placeholder="US" /></Label>
            <Label label="Indeed city"><Input value={l.indeedLocation} onChange={(e) => setLoc(i, { indeedLocation: e.target.value })} placeholder="optional" /></Label>
            <Check label="Remote" checked={l.remote} onChange={(e) => setLoc(i, { remote: e.target.checked })} />
            <Button small variant="danger" onClick={() => patch({ locations: search.locations.filter((_, n) => n !== i) })}>Remove</Button>
          </div>
        ))}
        <div><Button small onClick={() => patch({ locations: [...search.locations, newLocation()] })}>+ Add location</Button></div>
      </Card>

      <Card className="grid gap-3">
        <H>Pay and place</H>
        <P>Jobs that state pay below your minimum are dropped; other currencies are converted at approximate rates. Listings that state no pay are kept.</P>
        <div className="grid gap-3 sm:grid-cols-3">
          <Label label="Minimum pay" hint="0 turns this off.">
            <Input type="number" min={0} value={search.minPay.amount} onChange={(e) => patch({ minPay: { ...search.minPay, amount: Math.max(0, Number(e.target.value) || 0) } })} />
          </Label>
          <Label label="Currency">
            <Select value={search.minPay.currency} onChange={(e) => patch({ minPay: { ...search.minPay, currency: e.target.value } })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Label>
          <Label label="Per">
            <Select value={search.minPay.period} onChange={(e) => patch({ minPay: { ...search.minPay, period: e.target.value as "month" | "year" } })}>
              <option value="month">Month</option><option value="year">Year</option>
            </Select>
          </Label>
        </div>
        <Check label="Drop equity-only, volunteer and unpaid jobs" checked={search.dropUnpaid} onChange={(e) => patch({ dropUnpaid: e.target.checked })} />
        <Label label="Home city" hint="Onsite and hybrid jobs are kept only in this city. Remote jobs are kept from anywhere. Leave empty to keep every location.">
          <Input value={search.homeCity} onChange={(e) => patch({ homeCity: e.target.value })} placeholder="Islamabad" />
        </Label>
      </Card>

      <Card className="grid gap-3">
        <H>Sources and volume</H>
        <div className="flex flex-wrap gap-4">
          {(["linkedin", "indeed", "google"] as const).map((k) => (
            <Check key={k} label={{ linkedin: "LinkedIn", indeed: "Indeed", google: "Google (company career boards)" }[k]} checked={search.sources[k]} onChange={(e) => patch({ sources: { ...search.sources, [k]: e.target.checked } })} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Posted within">
            <Select value={search.postedWithinDays} onChange={(e) => patch({ postedWithinDays: Number(e.target.value) as 1 | 7 | 30 })}>
              <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
            </Select>
          </Label>
          <Label label="Jobs per search" hint={`${searches} searches per run → up to ${searches * search.maxPerSearch} LinkedIn jobs ≈ $${(searches * search.maxPerSearch * 0.0004).toFixed(2)} per run.`}>
            <Input type="number" min={5} max={100} value={search.maxPerSearch} onChange={(e) => patch({ maxPerSearch: Math.max(1, Number(e.target.value) || 1) })} />
          </Label>
        </div>
      </Card>
    </div>
  );
}

// ---------- profile (master CV) ----------

const splitBar = (line: string, n: number) => {
  const parts = line.split("|").map((p) => p.trim());
  return Array.from({ length: n }, (_, i) => parts[i] ?? "");
};

export function ProfileSection({ state }: { state: SettingsState }) {
  const { profile, setProfile } = state;
  const { busy, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  // Free-text editors keep their own draft so typing "|" or a newline is never fought by re-parsing.
  const [text, setText] = useState<Record<string, string> | null>(null);

  if (profile && !text) {
    setText({
      links: profile.links.map((l) => `${l.label} | ${l.url}`).join("\n"),
      projects: profile.projects.map((p) => [p.name, p.description, p.tech, p.url].join(" | ")).join("\n"),
      skills: profile.skills.map((s) => `${s.category}: ${s.items.join(", ")}`).join("\n"),
      education: profile.education.map((e) => [e.school, e.degree, e.start, e.end].join(" | ")).join("\n"),
    });
  }

  if (!profile || !text) return null;
  const set = (p: Partial<Profile>) => setProfile({ ...profile, ...p });
  const setExp = (i: number, p: Partial<Profile["experience"][number]>) =>
    set({ experience: profile.experience.map((e, n) => (n === i ? { ...e, ...p } : e)) });
  const edit = (k: string, parse: (v: string) => Partial<Profile>) => ({
    value: text[k],
    onChange: (e: { target: { value: string } }) => {
      setText({ ...text, [k]: e.target.value });
      set(parse(e.target.value));
    },
  });

  const upload = (f: File) =>
    run("parse", async () => {
      const form = new FormData();
      form.append("file", f);
      const r = await api<{ profile: Profile }>("/api/profile/parse", { form });
      setProfile(r.profile);
      setText(null);
      return "CV read. Check every field below, then save.";
    });

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Your master CV</H>
        <P>Tailored CVs only ever select and reorder what is written here. They never add experience, tools or numbers, so keep this complete and accurate.</P>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={file} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <Button busy={busy === "parse"} onClick={() => file.current?.click()}>Fill from a CV file (PDF)</Button>
          <span className="text-xs text-muted">Uses Claude to read the file. Takes up to a minute.</span>
        </div>
      </Card>

      <Card className="grid gap-3">
        <H>Basics</H>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Full name"><Input value={profile.name} onChange={(e) => set({ name: e.target.value })} /></Label>
          <Label label="Headline"><Input value={profile.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Full Stack Engineer | React · Node.js · Python" /></Label>
          <Label label="Email on CV"><Input type="email" value={profile.email} onChange={(e) => set({ email: e.target.value })} /></Label>
          <Label label="Phone"><Input value={profile.phone} onChange={(e) => set({ phone: e.target.value })} /></Label>
        </div>
        <Label label="Location"><Input value={profile.location} onChange={(e) => set({ location: e.target.value })} /></Label>
        <Label label="Links, one per line: Label | URL">
          <Textarea {...edit("links", (v) => ({ links: lines(v).map((l) => { const [label, url] = splitBar(l, 2); return { label, url }; }).filter((l) => l.url) }))} placeholder={"LinkedIn | https://linkedin.com/in/you\nGitHub | https://github.com/you"} />
        </Label>
        <Label label="Summary (optional)"><Textarea value={profile.summary} onChange={(e) => set({ summary: e.target.value })} /></Label>
      </Card>

      <Card className="grid gap-3">
        <H>Experience</H>
        {profile.experience.map((e, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Label label="Company"><Input value={e.company} onChange={(ev) => setExp(i, { company: ev.target.value })} /></Label>
              <Label label="Title"><Input value={e.title} onChange={(ev) => setExp(i, { title: ev.target.value })} /></Label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Label label="Location"><Input value={e.location} onChange={(ev) => setExp(i, { location: ev.target.value })} /></Label>
              <Label label="Start"><Input value={e.start} onChange={(ev) => setExp(i, { start: ev.target.value })} placeholder="Jan 2025" /></Label>
              <Label label="End"><Input value={e.end} onChange={(ev) => setExp(i, { end: ev.target.value })} placeholder="Present" /></Label>
            </div>
            <Label label="Bullets, one per line">
              <Textarea className="min-h-36" value={e.bullets.join("\n")} onChange={(ev) => setExp(i, { bullets: ev.target.value.split("\n") })} onBlur={(ev) => setExp(i, { bullets: lines(ev.target.value) })} />
            </Label>
            <div><Button small variant="danger" onClick={() => set({ experience: profile.experience.filter((_, n) => n !== i) })}>Remove this job</Button></div>
          </div>
        ))}
        <div><Button small onClick={() => set({ experience: [...profile.experience, { company: "", title: "", location: "", start: "", end: "", bullets: [] }] })}>+ Add job</Button></div>
      </Card>

      <Card className="grid gap-3">
        <H>Projects, skills, education</H>
        <Label label="Projects, one per line: Name | Description | Tech | URL">
          <Textarea {...edit("projects", (v) => ({ projects: lines(v).map((l) => { const [name, description, tech, url] = splitBar(l, 4); return { name, description, tech, url }; }).filter((p) => p.name) }))} />
        </Label>
        <Label label="Skills, one group per line: Category: skill, skill, skill">
          <Textarea className="min-h-36" {...edit("skills", (v) => ({ skills: lines(v).map((l) => { const at = l.indexOf(":"); return at === -1 ? { category: "Skills", items: l.split(",").map((x) => x.trim()).filter(Boolean) } : { category: l.slice(0, at).trim(), items: l.slice(at + 1).split(",").map((x) => x.trim()).filter(Boolean) }; }).filter((s) => s.items.length) }))} />
        </Label>
        <Label label="Education, one per line: School | Degree | Start | End">
          <Textarea {...edit("education", (v) => ({ education: lines(v).map((l) => { const [school, degree, start, end] = splitBar(l, 4); return { school, degree, start, end }; }).filter((e) => e.school) }))} />
        </Label>
      </Card>
    </div>
  );
}

// ---------- application-form answers ----------

export function ApplySection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const rows = settings.applyAnswers;
  const setRows = (applyAnswers: AppSettings["applyAnswers"]) => setSettings({ ...settings, applyAnswers });
  const setRow = (i: number, p: Partial<AppSettings["applyAnswers"][number]>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Application answers</H>
        <P>Application forms ask things your CV does not say. The JobPilot browser extension uses these answers when it fills a form. A question with no answer here, in your CV or in the job description is left empty for you; nothing is made up.</P>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <Label label={i === 0 ? "Question" : ""}><Input value={r.question} onChange={(e) => setRow(i, { question: e.target.value })} placeholder="Expected salary" /></Label>
            <Label label={i === 0 ? "Your answer" : ""}><Input value={r.answer} onChange={(e) => setRow(i, { answer: e.target.value })} placeholder="Leave empty to fill this one yourself each time" /></Label>
            <Button small variant="danger" onClick={() => setRows(rows.filter((_, n) => n !== i))}>Remove</Button>
          </div>
        ))}
        <div><Button small onClick={() => setRows([...rows, { question: "", answer: "" }])}>+ Add answer</Button></div>
      </Card>

      <Card className="grid gap-2">
        <H>Browser extension</H>
        <P>The extension lives in the <code>extension</code> folder of this project. In Chrome open <code>chrome://extensions</code>, switch on Developer mode, press “Load unpacked” and choose that folder. Then open a job post from the Jobs board, start the application and press the JobPilot icon → “Fill this page”. It fills the fields; you check them and press Submit yourself.</P>
      </Card>
    </div>
  );
}

// ---------- limits, schedule, call script ----------

export function LimitsSection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const caps = settings.caps;
  const setCap = (k: keyof AppSettings["caps"]) => (e: { target: { value: string } }) =>
    setSettings({ ...settings, caps: { ...caps, [k]: Math.max(0, Number(e.target.value) || 0) } });

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Safety limits</H>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Emails per day" hint="Sending stops for the day at this number."><Input type="number" min={1} max={100} value={caps.dailySend} onChange={setCap("dailySend")} /></Label>
          <Label label="Apify spend per month (USD)" hint="Runs are refused once the estimate reaches this. The free plan gives about $5."><Input type="number" min={0} step={0.5} value={caps.apifyMonthlyUsd} onChange={setCap("apifyMonthlyUsd")} /></Label>
          <Label label="Companies looked up per run" hint="About $0.01 each."><Input type="number" min={0} max={50} value={caps.enrichPerRun} onChange={setCap("enrichPerRun")} /></Label>
          <Label label="Applications written per run"><Input type="number" min={0} max={50} value={caps.draftPerRun} onChange={setCap("draftPerRun")} /></Label>
        </div>
      </Card>

      <Card className="grid gap-3">
        <H>Daily run</H>
        <P>Once a day, while JobPilot is running, it looks for jobs posted in the last 24 hours, scores them, looks up contacts and writes drafts. It never sends email.</P>
        <div className="flex flex-wrap items-end gap-4">
          <Check label="Run every day" checked={settings.schedule.enabled} onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, enabled: e.target.checked } })} />
          <Label label="Not before"><Input type="time" value={settings.schedule.time} onChange={(e) => setSettings({ ...settings, schedule: { ...settings.schedule, time: e.target.value || "08:00" } })} /></Label>
          <Label label="Follow up after (days)"><Input type="number" min={2} max={30} value={settings.outreach.followUpDays} onChange={(e) => setSettings({ ...settings, outreach: { ...settings.outreach, followUpDays: Math.max(2, Number(e.target.value) || 5) } })} /></Label>
        </div>
      </Card>

      <Card className="grid gap-3">
        <H>Call script</H>
        <P>Shown when you press Call. Placeholders: {"{contact}"}, {"{me}"}, {"{company}"}, {"{role}"}, {"{pitch}"}.</P>
        <Textarea className="min-h-40" value={settings.outreach.callScript} onChange={(e) => setSettings({ ...settings, outreach: { ...settings.outreach, callScript: e.target.value } })} />
      </Card>
    </div>
  );
}
