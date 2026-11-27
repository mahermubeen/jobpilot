"use client";

import { Button, Card, Check, Input, Label, Select, Textarea, useAction } from "@/components/ui";
import { api } from "@/lib/client";
import { CURRENCIES } from "@/lib/pay";
import type { AppSettings, SearchLocation } from "@/lib/settings";
import { SOURCES, type SourceDef } from "@/lib/sources/catalog";
import { searchTitles } from "@/lib/sources/match";
import { A, H, lines, P } from "./bits";
import type { SettingsState } from "./state";

type Search = AppSettings["search"];
type Patch = (p: Partial<Search>) => void;
type CardProps = { search: Search; patch: Patch };

const newLocation = (): SearchLocation => ({ label: "", linkedin: "", indeedCountry: "", indeedLocation: "", remote: false });
const csvLower = (v: string) => v.split(",").map((c) => c.trim().toLowerCase());
/** Paid Apify boards cost about this per job found. */
const USD_PER_PAID_JOB = 0.0004;

const SOURCE_GROUPS: { label: string; pick: (s: SourceDef) => boolean }[] = [
  { label: "Job boards (free, scraped on this computer)", pick: (s) => s.cost === "free" && s.group === "board" },
  { label: "Job board APIs (free, need a free key under Keys)", pick: (s) => s.cost === "free" && s.group === "api" },
  { label: "Remote job boards (free)", pick: (s) => s.cost === "free" && s.group === "remote" },
  { label: "Company career pages (free)", pick: (s) => s.cost === "free" && s.group === "ats" },
  { label: "Hiring posts (free)", pick: (s) => s.cost === "free" && s.group === "social" },
  { label: "Paid through Apify (counts against your monthly Apify cap)", pick: (s) => s.cost === "apify" },
];

function VariantChips({ extra, search, patch }: CardProps & { extra: string[] }) {
  const drop = (t: string) => search.titleVariants.filter((v) => v !== t);
  return (
    <div className="flex flex-wrap gap-1.5">
      {extra.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-xl bg-sunk py-0.5 pr-1 pl-2 text-xs">
          {t}
          <button type="button" title="Add to my titles" className="rounded px-1 font-bold text-accent hover:bg-accent-soft"
            onClick={() => patch({ titles: [...search.titles, t], titleVariants: drop(t) })}>+</button>
          <button type="button" title="Don't search this" className="rounded px-1 font-bold text-muted hover:text-bad"
            onClick={() => patch({ titleVariants: drop(t), excludedVariants: [...search.excludedVariants, t] })}>×</button>
        </span>
      ))}
    </div>
  );
}

function TitleVariants({ search, patch }: CardProps) {
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
        <VariantChips extra={extra} search={search} patch={patch} />
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

function TitlesCard({ search, patch }: CardProps) {
  return (
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
  );
}

function LocationRow({ l, set, remove }: { l: SearchLocation; set: (p: Partial<SearchLocation>) => void; remove: () => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.2fr_1.2fr_0.6fr_1fr_auto_auto] sm:items-end">
      <Label label="Label on cards"><Input value={l.label} onChange={(e) => set({ label: e.target.value })} placeholder="Worldwide remote" /></Label>
      <Label label="LinkedIn location"><Input value={l.linkedin} onChange={(e) => set({ linkedin: e.target.value })} placeholder="Worldwide" /></Label>
      <Label label="Indeed country"><Input value={l.indeedCountry} maxLength={2} onChange={(e) => set({ indeedCountry: e.target.value.toUpperCase() })} placeholder="US" /></Label>
      <Label label="Indeed city"><Input value={l.indeedLocation} onChange={(e) => set({ indeedLocation: e.target.value })} placeholder="optional" /></Label>
      <Check label="Remote" checked={l.remote} onChange={(e) => set({ remote: e.target.checked })} />
      <Button small variant="danger" onClick={remove}>Remove</Button>
    </div>
  );
}

function LocationsCard({ search, patch }: CardProps) {
  const setLoc = (i: number, p: Partial<SearchLocation>) => patch({ locations: search.locations.map((l, n) => (n === i ? { ...l, ...p } : l)) });
  return (
    <Card className="grid gap-3">
      <H>Locations</H>
      <P>“LinkedIn location” is what you would type in LinkedIn’s location box. For Indeed, give the two-letter country site (US, GB is UK, PK, AE, CA…) and optionally a city. Leave the Indeed country empty to skip Indeed for that row.</P>
      {search.locations.map((l, i) => (
        <LocationRow key={i} l={l} set={(p) => setLoc(i, p)} remove={() => patch({ locations: search.locations.filter((_, n) => n !== i) })} />
      ))}
      <div><Button small onClick={() => patch({ locations: [...search.locations, newLocation()] })}>+ Add location</Button></div>
    </Card>
  );
}

function PayCard({ search, patch }: CardProps) {
  const minPay = (p: Partial<Search["minPay"]>) => patch({ minPay: { ...search.minPay, ...p } });
  return (
    <Card className="grid gap-3">
      <H>Pay and place</H>
      <P>Jobs that state pay below your minimum are dropped; other currencies are converted at approximate rates. Listings that state no pay are kept.</P>
      <div className="grid gap-3 sm:grid-cols-3">
        <Label label="Minimum pay" hint="0 turns this off.">
          <Input type="number" min={0} value={search.minPay.amount} onChange={(e) => minPay({ amount: Math.max(0, Number(e.target.value) || 0) })} />
        </Label>
        <Label label="Currency">
          <Select value={search.minPay.currency} onChange={(e) => minPay({ currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Label>
        <Label label="Per">
          <Select value={search.minPay.period} onChange={(e) => minPay({ period: e.target.value as "month" | "year" })}>
            <option value="month">Month</option><option value="year">Year</option>
          </Select>
        </Label>
      </div>
      <Check label="Drop equity-only, volunteer and unpaid jobs" checked={search.dropUnpaid} onChange={(e) => patch({ dropUnpaid: e.target.checked })} />
      <Label label="Home city" hint="Onsite and hybrid jobs are kept only in this city. Remote jobs are kept from anywhere. Leave empty to keep every location.">
        <Input value={search.homeCity} onChange={(e) => patch({ homeCity: e.target.value })} placeholder="Islamabad" />
      </Label>
    </Card>
  );
}

function SourceGroups({ search, patch }: CardProps) {
  return (
    <>
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
    </>
  );
}

function SourcesCard({ search, patch }: CardProps) {
  return (
    <Card className="grid gap-4">
      <H>Where to look</H>
      <P>Free sources cost nothing. The job boards are scraped on this computer with JobSpy, which needs <A href="https://docs.astral.sh/uv/">uv</A> installed. Paid sources run on Apify and stop at your monthly cap.</P>
      <SourceGroups search={search} patch={patch} />
      <Label label="Company career pages to watch (one link per line)" hint="Greenhouse, Lever, Ashby, Workable, SmartRecruiters or Recruitee board links, e.g. https://jobs.lever.co/acme. Checked every run, on top of the ones JobSpy and Google turn up.">
        <Textarea value={search.watchCompanies.join("\n")} onChange={(e) => patch({ watchCompanies: e.target.value.split("\n") })} onBlur={(e) => patch({ watchCompanies: lines(e.target.value) })} placeholder={"https://boards.greenhouse.io/acme\nhttps://jobs.ashbyhq.com/beta"} />
      </Label>
      <Label label="Countries for remote jobs on Adzuna (two-letter codes, comma separated)" hint="Adzuna has no worldwide site, so remote locations are searched in these countries. It covers gb, us, ca, au, de, fr, nl, at, be, ch, es, it, pl, in, sg, nz, za, br, mx.">
        <Input value={search.remoteCountries.join(", ")} onChange={(e) => patch({ remoteCountries: csvLower(e.target.value) })} onBlur={(e) => patch({ remoteCountries: csvLower(e.target.value).filter(Boolean) })} placeholder="us, gb, ca, au, de" />
      </Label>
      {search.sources.craigslist && (
        <Label label="Craigslist cities (one per line)" hint="The part before .craigslist.org, e.g. sfbay, newyork, london, manchester, toronto, sydney. Searches software jobs and computer gigs; with a remote location only telecommute jobs. Each city costs up to 2 × “Jobs per search, paid sources”.">
          <Textarea value={search.craigslistCities.join("\n")} onChange={(e) => patch({ craigslistCities: e.target.value.split("\n") })} onBlur={(e) => patch({ craigslistCities: lines(e.target.value) })} placeholder={"sfbay\nnewyork\nlondon"} />
        </Label>
      )}
    </Card>
  );
}

/** "4 titles × 2 locations × 3 paid boards → up to 1200 jobs ≈ $0.48 per run." */
function paidHint(search: Search): string {
  const paidTitles = Math.min(searchTitles(search).length, Math.max(search.titles.length, 4));
  const paidBoards = ["linkedin", "indeed", "glassdoor"].filter((k) => search.sources[k]).length;
  if (!paidBoards) return "No paid job boards switched on.";
  const paidJobs = paidTitles * search.locations.length * paidBoards * search.maxPerSearch;
  return `${paidTitles} titles × ${search.locations.length} locations × ${paidBoards} paid boards → up to ${paidJobs} jobs ≈ $${(paidJobs * USD_PER_PAID_JOB).toFixed(2)} per run.`;
}

function VolumeCard({ search, patch }: CardProps) {
  return (
    <Card className="grid gap-3">
      <H>Volume</H>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Jobs per search, free boards" hint="Higher finds more but takes longer; LinkedIn may slow down past about 100.">
          <Input type="number" min={5} max={200} value={search.maxPerFreeSearch} onChange={(e) => patch({ maxPerFreeSearch: Math.max(1, Number(e.target.value) || 1) })} />
        </Label>
        <Label label="Jobs per search, paid sources" hint={paidHint(search)}>
          <Input type="number" min={5} max={100} value={search.maxPerSearch} onChange={(e) => patch({ maxPerSearch: Math.max(1, Number(e.target.value) || 1) })} />
        </Label>
      </div>
    </Card>
  );
}

export function SearchSection({ state }: { state: SettingsState }) {
  const { settings, setSettings } = state;
  if (!settings) return null;
  const search = settings.search;
  const patch: Patch = (p) => setSettings({ ...settings, search: { ...search, ...p } });
  const props = { search, patch };
  return (
    <div className="grid gap-4">
      <TitlesCard {...props} />
      <LocationsCard {...props} />
      <PayCard {...props} />
      <SourcesCard {...props} />
      <VolumeCard {...props} />
    </div>
  );
}
