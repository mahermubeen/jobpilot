"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Card, Check, Input, Label, Select, Tag, Textarea, useAction } from "@/components/ui";
import { api, useLoad } from "@/lib/client";
import type { Profile } from "@/lib/cv/types";
import { CURRENCIES } from "@/lib/pay";
import { AI_CATALOG, type AiKind, type ChainEntry } from "@/lib/ai/catalog";
import type { DetectedAi } from "@/lib/ai/detect";
import type { ApplyFacts, AppSettings, SearchLocation, Secrets } from "@/lib/settings";
import { SOURCES, type SourceDef } from "@/lib/sources/catalog";
import { searchTitles } from "@/lib/sources/match";

type SecretStatus = {
  anthropicKey: boolean; aiKey: boolean; openaiKey: boolean; geminiKey: boolean; xaiKey: boolean; groqKey: boolean; apifyToken: boolean; gmailUser: string; gmailAppPassword: boolean; apolloKey: boolean;
  adzunaAppId: boolean; adzunaKey: boolean; reedKey: boolean; joobleKey: boolean;
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

// ---------- AI ----------

type ChainState = {
  found: DetectedAi;
  status: { kind: AiKind; enabled: boolean; missing: string | null; parked: { reason: string; message: string; until: number | null } | null; ready: boolean }[];
  usage: { day: string; calls: Partial<Record<AiKind, number>>; tokens?: Partial<Record<AiKind, { in: number; out: number }>>; last?: AiKind };
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function chainTag(kind: AiKind, st: ChainState["status"][number] | undefined, found: DetectedAi | undefined) {
  if (!st) return null;
  if (!st.enabled) return <Tag>Off</Tag>;
  if (kind === "claude-cli" && found && !found.claude.installed) return <Tag tone="warn">Not installed</Tag>;
  if (kind === "gemini-cli" && found && !found.gemini.installed) return <Tag tone="warn">Not installed</Tag>;
  if (kind === "ollama" && found && !found.ollama.running) return <Tag tone="warn">Ollama not running</Tag>;
  if (st.missing) return <Tag tone="warn">{st.missing}</Tag>;
  if (st.parked) {
    const until = st.parked.until ? ` until ${timeOf(st.parked.until)}` : "";
    const label = st.parked.reason === "rate" ? `Rate-limited${until}` : st.parked.reason === "quota" ? `Out of credits${until}` : st.parked.reason === "auth" ? "Key rejected" : `Failing${until}`;
    return <span title={st.parked.message}><Tag tone="bad">{label}</Tag></span>;
  }
  return <Tag tone="good">Ready</Tag>;
}

/** Write/score model boxes, suggesting the models this AI offers. */
function ModelBoxes({ entry, onChange, reloadKey }: { entry: ChainEntry; onChange: (e: ChainEntry) => void; reloadKey: number }) {
  const { data } = useLoad<{ models: string[] }>(`/api/settings/ai-models?kind=${entry.kind}&r=${reloadKey}`);
  const options = data?.models ?? AI_CATALOG[entry.kind].suggestions;
  const id = `models-${entry.kind}`;
  const box = (k: "write" | "score") =>
    entry.kind === "ollama" && options.length ? (
      <Select value={entry[k]} onChange={(e) => onChange({ ...entry, [k]: e.target.value })}>
        <option value="">Pick a model…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    ) : (
      <Input list={id} value={entry[k]} onChange={(e) => onChange({ ...entry, [k]: e.target.value })} />
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <Label label="Model for writing" hint="CVs, cover letters, open answers">{box("write")}</Label>
      <Label label="Model for quick tasks" hint="Scoring jobs, short form answers">{box("score")}</Label>
    </div>
  );
}

function AiChainCard({ state, secrets, sec, saveAll }: {
  state: SettingsState;
  secrets: SecretStatus;
  sec: (k: keyof Secrets) => { value: string; onChange: (e: { target: { value: string } }) => void };
  saveAll: () => Promise<void>;
}) {
  const { settings, setSettings } = state;
  const { data: live, reload } = useLoad<ChainState>("/api/settings/ai-providers", 15_000);
  const [open, setOpen] = useState<AiKind | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { busy, run } = useAction();
  if (!settings) return null;
  const chain = settings.ai.chain;
  const setChain = (next: ChainEntry[]) => setSettings({ ...settings, ai: { ...settings.ai, chain: next } });
  const setEntry = (e: ChainEntry) => setChain(chain.map((x) => (x.kind === e.kind ? e : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...chain];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setChain(next);
  };
  const statusOf = (k: AiKind) => live?.status.find((x) => x.kind === k);
  const nowUsing = chain.find((e) => statusOf(e.kind)?.ready);
  const connected = live?.status.filter((x) => x.enabled && !x.missing).length ?? 0;
  const enabled = chain.filter((e) => e.enabled).length;
  const calls = Object.entries(live?.usage.calls ?? {}).filter(([, n]) => n);
  const total = calls.reduce((t, [, n]) => t + (n ?? 0), 0);
  const tokensOf = (k: string) => {
    const t = live?.usage.tokens?.[k as AiKind];
    return t ? t.in + t.out : 0;
  };
  const totalTokens = calls.reduce((t, [k]) => t + tokensOf(k), 0);
  const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const save = () =>
    run("ai-save", async () => {
      await saveAll();
      await reload();
      setReloadKey((k) => k + 1);
      return "Saved";
    });

  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H>AI (scores jobs, tailors your CV, writes letters and form answers)</H>
        <Button small variant="primary" busy={busy === "ai-save"} onClick={save}>Save AI settings</Button>
      </div>
      <P>
        Every AI task goes to the first AI below that is on, set up and has credit. When one runs out of credits, hits a rate limit or fails,
        JobPilot sets it aside and moves to the next. Use ↑ ↓ to change the order.
      </P>
      <div className="rounded-lg border border-line px-3 py-2 text-sm">
        <b>Now using:</b> {nowUsing ? AI_CATALOG[nowUsing.kind].name : <span className="text-bad">nothing — set up at least one AI</span>}
        <span className="text-muted"> · {connected} of {enabled} switched-on AIs connected · today: {total} call{total === 1 ? "" : "s"}{totalTokens ? ` · ${kTok(totalTokens)} tokens` : ""}</span>
        {calls.length ? <span className="text-muted"> ({calls.map(([k, n]) => `${AI_CATALOG[k as AiKind].name.split(" (")[0]} ${n}${tokensOf(k) ? ` · ${kTok(tokensOf(k))}` : ""}`).join(", ")})</span> : null}
      </div>

      <ol className="grid gap-2">
        {chain.map((entry, i) => {
          const info = AI_CATALOG[entry.kind];
          const expanded = open === entry.kind;
          return (
            <li key={entry.kind} className="grid gap-2 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-5 text-xs font-bold text-muted">{i + 1}.</span>
                <Button small onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
                <Button small onClick={() => move(i, 1)} disabled={i === chain.length - 1} aria-label="Move down">↓</Button>
                <Check label="" checked={entry.enabled} onChange={(e) => setEntry({ ...entry, enabled: e.target.checked })} aria-label={`Use ${info.name}`} />
                <b>{info.name}</b>
                {chainTag(entry.kind, statusOf(entry.kind), live?.found)}
                <span className="ml-auto" />
                <Button small onClick={() => setOpen(expanded ? null : entry.kind)}>{expanded ? "Close" : "Set up"}</Button>
              </div>
              <span className="pl-7 text-sm text-muted">{info.about}</span>
              {expanded ? (
                <div className="grid gap-3 pl-7">
                  <P>
                    <b>How to connect:</b> {info.setup}
                    {info.keyUrl ? <> <A href={info.keyUrl}>Open {info.keyUrl.replace(/^https:\/\//, "").split("/")[0]}</A></> : null}
                  </P>
                  {entry.kind === "custom" || entry.kind === "ollama" ? (
                    <Label label={entry.kind === "ollama" ? "Ollama address" : "Server URL (ending in /v1)"}>
                      <Input value={entry.baseUrl ?? ""} placeholder={entry.kind === "ollama" ? "http://127.0.0.1:11434" : "https://openrouter.ai/api/v1"} onChange={(e) => setEntry({ ...entry, baseUrl: e.target.value })} />
                    </Label>
                  ) : null}
                  {info.keyName ? (
                    <Label label="API key" hint={secrets[info.keyName] ? "A key is saved. Leave blank to keep it." : undefined}>
                      <Input type="password" autoComplete="off" {...sec(info.keyName)} />
                    </Label>
                  ) : null}
                  <ModelBoxes entry={entry} onChange={setEntry} reloadKey={reloadKey} />
                  <TestButton target={`ai:${entry.kind}`} before={async () => { await saveAll(); setReloadKey((k) => k + 1); }} after={reload} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---------- connections ----------

function TestButton({ target, before, after }: { target: string; before?: () => Promise<void>; after?: () => unknown }) {
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
            await after?.();
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
  const { data, settings, save } = state;
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
      <AiChainCard state={state} secrets={s} sec={sec} saveAll={saveAll} />

      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Apify (finds jobs and company contacts)</H>{saved(s.apifyToken)}</div>
        <P>Create a free account at <A href="https://console.apify.com/sign-up">apify.com</A>, then copy your token from <A href="https://console.apify.com/settings/integrations">Settings → API &amp; Integrations</A>. The free plan includes about $5 of usage a month.</P>
        <Label label="Apify API token" hint={s.apifyToken ? "A token is saved. Leave blank to keep it." : undefined}>
          <Input type="password" autoComplete="off" placeholder="apify_api_…" {...sec("apifyToken")} />
        </Label>
        <TestButton target="apify" before={saveAll} />
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><H>Job board keys (free)</H>{saved(s.adzunaKey || s.reedKey || s.joobleKey)}</div>
        <P>Each board gives a free key when you sign up: <A href="https://developer.adzuna.com/signup">Adzuna</A> (US, UK and 17 more countries), <A href="https://www.reed.co.uk/developers/jobseeker">Reed</A> (UK) and <A href="https://jooble.org/api/about">Jooble</A> (about 70 countries). A board without a key is skipped. Turn boards on or off under Search → Where to look.</P>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Adzuna app ID" hint={s.adzunaAppId ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="e.g. 1a2b3c4d" {...sec("adzunaAppId")} />
          </Label>
          <Label label="Adzuna app key" hint={s.adzunaKey ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="32 letters and numbers" {...sec("adzunaKey")} />
          </Label>
          <Label label="Reed API key" hint={s.reedKey ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="xxxxxxxx-xxxx-…" {...sec("reedKey")} />
          </Label>
          <Label label="Jooble API key" hint={s.joobleKey ? "Saved. Leave blank to keep it." : undefined}>
            <Input type="password" autoComplete="off" placeholder="xxxxxxxx-xxxx-…" {...sec("joobleKey")} />
          </Label>
        </div>
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

const SOURCE_GROUPS: { label: string; pick: (s: SourceDef) => boolean }[] = [
  { label: "Job boards (free, scraped on this computer)", pick: (s) => s.cost === "free" && s.group === "board" },
  { label: "Job board APIs (free, need a free key under Keys)", pick: (s) => s.cost === "free" && s.group === "api" },
  { label: "Remote job boards (free)", pick: (s) => s.cost === "free" && s.group === "remote" },
  { label: "Company career pages (free)", pick: (s) => s.cost === "free" && s.group === "ats" },
  { label: "Hiring posts (free)", pick: (s) => s.cost === "free" && s.group === "social" },
  { label: "Paid through Apify (counts against your monthly Apify cap)", pick: (s) => s.cost === "apify" },
];

function TitleVariants({ search, patch }: { search: AppSettings["search"]; patch: (p: Partial<AppSettings["search"]>) => void }) {
  const { busy, run } = useAction();
  const all = searchTitles(search);
  const own = new Set(search.titles.map((t) => t.trim()));
  const extra = all.filter((t) => !own.has(t));
  const regenerate = () =>
    run("variants", async () => {
      const res = await api<{ titleVariants: string[]; variantsKey: string }>("/api/settings/title-variants", {
        method: "POST",
        body: { titles: search.titles, excludedVariants: search.excludedVariants },
      });
      patch({ titleVariants: res.titleVariants, variantsKey: res.variantsKey });
      return `${res.titleVariants.length} more titles ready. Save to keep any other changes.`;
    });

  return (
    <div className="grid gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          Searching {all.length} titles{extra.length ? ` (${search.titles.length} yours + ${extra.length} more made by AI from your CV)` : ""}
        </span>
        <div className="flex items-center gap-3">
          <Check label="Make more automatically" checked={search.autoVariants} onChange={(e) => patch({ autoVariants: e.target.checked })} />
          <Button small busy={busy === "variants"} onClick={regenerate}>{extra.length ? "Remake" : "Make now"}</Button>
        </div>
      </div>
      {extra.length ? (
        <div className="flex flex-wrap gap-1.5">
          {extra.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-xl bg-sunk py-0.5 pr-1 pl-2 text-xs">
              {t}
              <button type="button" title="Add to my titles" className="rounded px-1 font-bold text-accent hover:bg-accent-soft"
                onClick={() => patch({ titles: [...search.titles, t], titleVariants: search.titleVariants.filter((v) => v !== t) })}>+</button>
              <button type="button" title="Don't search this" className="rounded px-1 font-bold text-muted hover:text-bad"
                onClick={() => patch({ titleVariants: search.titleVariants.filter((v) => v !== t), excludedVariants: [...search.excludedVariants, t] })}>×</button>
            </span>
          ))}
        </div>
      ) : (
        <P>{search.autoVariants ? "More titles are made from your titles and CV at the start of the next search." : "Only your own titles are searched."}</P>
      )}
      {search.excludedVariants.length ? (
        <p className="text-xs text-muted">
          Removed: {search.excludedVariants.join(", ")}{" "}
          <button type="button" className="font-semibold text-accent hover:underline" onClick={() => patch({ excludedVariants: [] })}>Allow again</button>
        </p>
      ) : null}
      <p className="text-xs text-muted">“+” moves a title into your own list; “×” stops searching it. Feeds, career pages and posts are matched against all of them. The big boards (LinkedIn, Indeed…) search your own titles, topped up from these to 8; paid sources top up to 4.</p>
    </div>
  );
}

export function SearchSection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const search = settings.search;
  const patch = (p: Partial<AppSettings["search"]>) => setSettings({ ...settings, search: { ...search, ...p } });
  const setLoc = (i: number, p: Partial<SearchLocation>) =>
    patch({ locations: search.locations.map((l, n) => (n === i ? { ...l, ...p } : l)) });
  const paidTitles = Math.min(searchTitles(search).length, Math.max(search.titles.length, 4));
  const paidBoards = ["linkedin", "indeed", "glassdoor"].filter((k) => search.sources[k]).length;
  const paidJobs = paidTitles * search.locations.length * paidBoards * search.maxPerSearch;

  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <H>Job titles</H>
        <Label label="One per line" hint="Each title is searched in each location below.">
          <Textarea value={search.titles.join("\n")} onChange={(e) => patch({ titles: e.target.value.split("\n") })} onBlur={(e) => patch({ titles: lines(e.target.value) })} placeholder={"Full Stack Engineer\nReact Native Developer"} />
        </Label>
        <TitleVariants search={search} patch={patch} />
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

      <Card className="grid gap-4">
        <H>Where to look</H>
        <P>Free sources cost nothing. The job boards are scraped on this computer with JobSpy, which needs <A href="https://docs.astral.sh/uv/">uv</A> installed. Paid sources run on Apify and stop at your monthly cap.</P>
        {SOURCE_GROUPS.map((g) => (
          <div key={g.label} className="grid gap-2">
            <span className="text-xs font-bold text-muted uppercase">{g.label}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {SOURCES.filter(g.pick).map((src) => (
                <div key={src.key} className="grid gap-0.5">
                  <Check label={src.label} checked={!!search.sources[src.key]} onChange={(e) => patch({ sources: { ...search.sources, [src.key]: e.target.checked } })} />
                  <span className="pl-6 text-xs text-muted">{src.hint}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <Label label="Company career pages to watch (one link per line)" hint="Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee board links, e.g. https://jobs.lever.co/acme. Checked every run, on top of the ones JobSpy and Google turn up.">
          <Textarea value={search.watchCompanies.join("\n")} onChange={(e) => patch({ watchCompanies: e.target.value.split("\n") })} onBlur={(e) => patch({ watchCompanies: lines(e.target.value) })} placeholder={"https://boards.greenhouse.io/acme\nhttps://jobs.ashbyhq.com/beta"} />
        </Label>
        <Label label="Countries for remote jobs on Adzuna (two-letter codes, comma separated)" hint="Adzuna has no worldwide site, so remote locations are searched in these countries. It covers gb, us, ca, au, de, fr, nl, at, be, ch, es, it, pl, in, sg, nz, za, br, mx.">
          <Input value={search.remoteCountries.join(", ")} onChange={(e) => patch({ remoteCountries: e.target.value.split(",").map((c) => c.trim().toLowerCase()) })} onBlur={(e) => patch({ remoteCountries: e.target.value.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean) })} placeholder="us, gb, ca, au, de" />
        </Label>
        {search.sources.craigslist && (
          <Label label="Craigslist cities (one per line)" hint="The part before .craigslist.org, e.g. sfbay, newyork, london, manchester, toronto, sydney. Searches software jobs and computer gigs; with a remote location only telecommute jobs. Each city costs up to 2 × “Jobs per search, paid sources”.">
            <Textarea value={search.craigslistCities.join("\n")} onChange={(e) => patch({ craigslistCities: e.target.value.split("\n") })} onBlur={(e) => patch({ craigslistCities: lines(e.target.value) })} placeholder={"sfbay\nnewyork\nlondon"} />
          </Label>
        )}
      </Card>

      <Card className="grid gap-3">
        <H>Volume</H>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label="Jobs per search, free boards" hint="Higher finds more but takes longer; LinkedIn may slow down past about 100.">
            <Input type="number" min={5} max={200} value={search.maxPerFreeSearch} onChange={(e) => patch({ maxPerFreeSearch: Math.max(1, Number(e.target.value) || 1) })} />
          </Label>
          <Label label="Jobs per search, paid sources" hint={paidBoards ? `${paidTitles} titles × ${search.locations.length} locations × ${paidBoards} paid boards → up to ${paidJobs} jobs ≈ $${(paidJobs * 0.0004).toFixed(2)} per run.` : "No paid job boards switched on."}>
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

type Learned = { id: string; question: string; answer: string | string[]; scope: string; uses: number; at: number; by?: string };

/** Answers JobPilot remembered from AI replies and from forms you filled yourself: correct or forget any of them. */
function LearnedCard() {
  const { data, reload } = useLoad<{ answers: Learned[] }>("/api/apply/learned");
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const list = (data?.answers ?? []).filter((a) => !filter || a.question.toLowerCase().includes(filter.toLowerCase()));
  const shown = list.slice(0, 100);
  const text = (a: Learned) => (Array.isArray(a.answer) ? a.answer.join(", ") : a.answer);
  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H>Answers JobPilot learned ({data?.answers.length ?? 0})</H>
        <Input className="w-56" placeholder="Search questions" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <P>Every answer the AI writes is kept here, so the same question is never sent to the AI again. So is every answer you type or pick yourself on a form: the extension saves it when you press Submit, Next or Continue, and your answers win over the built-in answer bank. Answers written for one job (“Why do you want to work here?”) are only reused for that job. Fix a wrong one here and it is used from then on.</P>
      {shown.map((a) => (
        <div key={a.id} className="grid gap-1 border-t border-line pt-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b className="min-w-0 flex-1">{a.question}</b>
            <Tag tone={a.by === "you" ? "good" : undefined}>{a.by === "you" ? "yours" : "AI"}</Tag>
            <Tag>{a.scope === "all" ? "all jobs" : "one job"}</Tag>
            {a.uses ? <Tag tone="good">reused {a.uses}×</Tag> : null}
          </div>
          <div className="flex gap-2">
            <Input value={edits[a.id] ?? text(a)} onChange={(e) => setEdits((x) => ({ ...x, [a.id]: e.target.value }))} />
            {edits[a.id] !== undefined && edits[a.id] !== text(a) ? (
              <Button small variant="primary" busy={busy === `s${a.id}`} onClick={() => run(`s${a.id}`, async () => {
                await api("/api/apply/learned", { method: "PATCH", body: { id: a.id, answer: Array.isArray(a.answer) ? edits[a.id].split(/\s*,\s*/) : edits[a.id] } });
                setEdits((x) => {
                  const next = { ...x };
                  delete next[a.id];
                  return next;
                });
                await reload();
                return "Saved";
              })}>Save</Button>
            ) : null}
            <Button small variant="danger" busy={busy === `d${a.id}`} onClick={() => run(`d${a.id}`, async () => {
              await api(`/api/apply/learned?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
              await reload();
              return "Forgotten";
            })}>Forget</Button>
          </div>
        </div>
      ))}
      {list.length > shown.length ? <P>Showing 100 of {list.length}. Search to find others.</P> : null}
      {data && !data.answers.length ? <P>Nothing yet. After the extension asks the AI something, the answer shows up here.</P> : null}
    </Card>
  );
}

const csv = (a: string[]) => a.join(", ");
const fromCsv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Your standing facts: the question bank answers from these with no AI. */
function FactsCard({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const f = settings.applyFacts;
  const set = (p: Partial<ApplyFacts>) => setSettings({ ...settings, applyFacts: { ...f, ...p } });
  const text = (k: keyof ApplyFacts, label: string, hint?: string, placeholder?: string) => (
    <Label label={label} hint={hint}>
      <Input value={String(f[k] ?? "")} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<ApplyFacts>)} />
    </Label>
  );
  const toggle = <T extends string>(k: "workModes" | "employmentTypes", all: readonly T[]) => (
    <div className="flex flex-wrap gap-3">
      {all.map((v) => (
        <Check key={v} label={v} checked={(f[k] as string[]).includes(v)} onChange={(e) => set({ [k]: e.target.checked ? [...(f[k] as string[]), v] : (f[k] as string[]).filter((x) => x !== v) } as Partial<ApplyFacts>)} />
      ))}
    </div>
  );
  const money = (k: "target" | "last" | "floor", label: string, hint: string) => (
    <Label label={label} hint={hint}>
      <Input type="number" min={0} value={f.salary[k] || ""} onChange={(e) => set({ salary: { ...f.salary, [k]: Number(e.target.value) || 0 } })} />
    </Label>
  );
  const DEMO = "Prefer not to say";
  const demo = (k: keyof ApplyFacts, label: string, options: string[]) => (
    <Label label={label}>
      <Select value={String(f[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<ApplyFacts>)}>
        {[...new Set([...options, DEMO, String(f[k])])].map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    </Label>
  );

  return (
    <Card className="grid gap-4">
      <div>
        <H>Your facts</H>
        <P>The built-in question bank answers about 50 common questions from these (and your CV) without any AI: location, work rights, sponsorship, notice period, start date, salary, years of experience, education, consent boxes, “how did you hear about us”, diversity questions and more. Press Save changes at the top when done.</P>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {text("city", "City", undefined, "Islamabad")}
        {text("region", "State / province", undefined, "Islamabad Capital Territory")}
        {text("country", "Country", undefined, "Pakistan")}
        {text("postalCode", "Postal code", "Left empty on forms if blank")}
        {text("address", "Street address", "Left empty on forms if blank")}
        {text("nationality", "Nationality", undefined, "Pakistani")}
        {text("timezone", "Time zone", undefined, "PKT (UTC+5)")}
        {text("pronouns", "Pronouns", undefined, "he/him")}
        {text("totalYears", "Total years of experience", undefined, "6")}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Countries you can work in without sponsorship" hint="Comma-separated. Anywhere else, forms are told you need sponsorship.">
          <Input value={csv(f.authorizedCountries)} placeholder="Pakistan" onChange={(e) => set({ authorizedCountries: fromCsv(e.target.value) })} />
        </Label>
        <Label label="Notice period (days)" hint="Start date = today + this">
          <Input type="number" min={0} value={f.noticeDays} onChange={(e) => set({ noticeDays: Number(e.target.value) || 0 })} />
        </Label>
        {text("languages", "Languages", undefined, "English (Fluent), Urdu (Native)")}
        {text("english", "English level", undefined, "Fluent")}
        {text("hoursOverlap", "Working-hours overlap answer", "Used when a form asks in words")}
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-semibold">Work setups you accept</span>
        {toggle("workModes", ["Remote", "Hybrid", "Onsite"] as const)}
        <span className="text-sm font-semibold">Job types you accept</span>
        {toggle("employmentTypes", ["Full-time", "Part-time", "Contract", "Internship"] as const)}
        <div className="flex flex-wrap gap-4">
          <Check label="Willing to relocate" checked={f.relocate} onChange={(e) => set({ relocate: e.target.checked })} />
          <Check label="Willing to travel" checked={f.travel} onChange={(e) => set({ travel: e.target.checked })} />
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-semibold">Salary (per month)</span>
        <P>When a job states a range, JobPilot asks for its maximum, but never less than your floor. With no range: your target for jobs in your country, or a competitive market rate (worked out once per role) for jobs abroad. Amounts are converted to the currency and period each form asks for.</P>
        <div className="grid gap-3 sm:grid-cols-4">
          <Label label="Currency">
            <Select value={f.salary.currency} onChange={(e) => set({ salary: { ...f.salary, currency: e.target.value } })}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Label>
          {money("target", "Target", "What you ask for")}
          {money("last", "Current / last", "For “current salary”")}
          {money("floor", "Floor", "Never ask below this")}
        </div>
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-semibold">Voluntary diversity questions</span>
        <div className="grid gap-3 sm:grid-cols-4">
          {demo("gender", "Gender", ["Male", "Female", "Non-binary"])}
          {demo("ethnicity", "Race / ethnicity", ["Asian", "White", "Black or African American", "Hispanic or Latino", "Middle Eastern", "Two or more races"])}
          {demo("hispanic", "Hispanic or Latino", ["No", "Yes"])}
          {demo("veteran", "Veteran", ["No", "Yes"])}
          {demo("disability", "Disability", ["No", "Yes"])}
          {demo("orientation", "Sexual orientation", ["Heterosexual", "Gay or lesbian", "Bisexual"])}
          {demo("transgender", "Transgender", ["No", "Yes"])}
        </div>
      </div>
    </Card>
  );
}

export function ApplySection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const rows = settings.applyAnswers;
  const setRows = (applyAnswers: AppSettings["applyAnswers"]) => setSettings({ ...settings, applyAnswers });
  const setRow = (i: number, p: Partial<AppSettings["applyAnswers"][number]>) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));

  return (
    <div className="grid gap-4">
      <Card className="grid gap-2">
        <H>How the extension answers a form</H>
        <P>For each empty field, in this order: <b>1.</b> your CV (name, email, phone, links) → <b>2.</b> the question bank, using your facts below → <b>3.</b> your own answers → <b>4.</b> answers it learned earlier → <b>5.</b> the AI, only for what is still unanswered. Short questions go to the cheap model; open questions get 1–3 sentences, 60 words at most. Every AI answer is saved, so it is asked once.</P>
      </Card>

      <FactsCard state={state} />

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

      <LearnedCard />

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
