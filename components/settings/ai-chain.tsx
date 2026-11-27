"use client";

import { useState } from "react";
import { Button, Card, Check, Input, Label, Select, Tag, useAction } from "@/components/ui";
import { AI_CATALOG, type AiKind, type ChainEntry } from "@/lib/ai/catalog";
import type { DetectedAi } from "@/lib/ai/detect";
import { useLoad } from "@/lib/client";
import type { Secrets } from "@/lib/settings";
import { A, H, P, TestButton } from "./bits";
import type { SecretStatus, SettingsState } from "./state";

type Status = { kind: AiKind; enabled: boolean; missing: string | null; parked: { reason: string; message: string; until: number | null } | null; ready: boolean };
type ChainState = {
  found: DetectedAi;
  status: Status[];
  usage: { day: string; calls: Partial<Record<AiKind, number>>; tokens?: Partial<Record<AiKind, { in: number; out: number }>>; last?: AiKind };
};
export type SecretInput = (k: keyof Secrets) => { value: string; onChange: (e: { target: { value: string } }) => void };

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** A local AI (CLI or Ollama) that this computer does not have running. */
function notInstalled(kind: AiKind, found: DetectedAi | undefined): string | null {
  if (!found) return null;
  if (kind === "claude-cli" && !found.claude.installed) return "Not installed";
  if (kind === "gemini-cli" && !found.gemini.installed) return "Not installed";
  return kind === "ollama" && !found.ollama.running ? "Ollama not running" : null;
}

function parkedLabel(parked: NonNullable<Status["parked"]>): string {
  const until = parked.until ? ` until ${timeOf(parked.until)}` : "";
  const labels: Record<string, string> = { rate: `Rate-limited${until}`, quota: `Out of credits${until}`, auth: "Key rejected" };
  return labels[parked.reason] ?? `Failing${until}`;
}

function ChainTag({ kind, st, found }: { kind: AiKind; st: Status | undefined; found: DetectedAi | undefined }) {
  if (!st) return null;
  if (!st.enabled) return <Tag>Off</Tag>;
  const local = notInstalled(kind, found);
  if (local) return <Tag tone="warn">{local}</Tag>;
  if (st.missing) return <Tag tone="warn">{st.missing}</Tag>;
  if (st.parked) return <span title={st.parked.message}><Tag tone="bad">{parkedLabel(st.parked)}</Tag></span>;
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

/** "Now using …, n of m connected, today: k calls · 12.3k tokens (per AI)". */
function UsageLine({ chain, live }: { chain: ChainEntry[]; live: ChainState | null }) {
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
  const perAi = calls.map(([k, n]) => `${AI_CATALOG[k as AiKind].name.split(" (")[0]} ${n}${tokensOf(k) ? ` · ${kTok(tokensOf(k))}` : ""}`).join(", ");
  return (
    <div className="rounded-lg border border-line px-3 py-2 text-sm">
      <b>Now using:</b> {nowUsing ? AI_CATALOG[nowUsing.kind].name : <span className="text-bad">nothing — set up at least one AI</span>}
      <span className="text-muted"> · {connected} of {enabled} switched-on AIs connected · today: {total} call{total === 1 ? "" : "s"}{totalTokens ? ` · ${kTok(totalTokens)} tokens` : ""}</span>
      {calls.length ? <span className="text-muted"> ({perAi})</span> : null}
    </div>
  );
}

type RowProps = {
  entry: ChainEntry;
  index: number;
  count: number;
  live: ChainState | null;
  setup: { secrets: SecretStatus; sec: SecretInput; saveAll: () => Promise<void>; reload: () => unknown; reloadKey: number; bumpModels: () => void };
  onChange: (e: ChainEntry) => void;
  onMove: (d: -1 | 1) => void;
  /** One row is set up at a time. */
  expanded: boolean;
  onToggle: () => void;
};

function ChainSetup({ entry, setup, onChange }: Pick<RowProps, "entry" | "setup" | "onChange">) {
  const info = AI_CATALOG[entry.kind];
  const hasUrl = entry.kind === "custom" || entry.kind === "ollama";
  return (
    <div className="grid gap-3 pl-7">
      <P>
        <b>How to connect:</b> {info.setup}
        {info.keyUrl ? <> <A href={info.keyUrl}>Open {info.keyUrl.replace(/^https:\/\//, "").split("/")[0]}</A></> : null}
      </P>
      {hasUrl ? (
        <Label label={entry.kind === "ollama" ? "Ollama address" : "Server URL (ending in /v1)"}>
          <Input value={entry.baseUrl ?? ""} placeholder={entry.kind === "ollama" ? "http://127.0.0.1:11434" : "https://openrouter.ai/api/v1"} onChange={(e) => onChange({ ...entry, baseUrl: e.target.value })} />
        </Label>
      ) : null}
      {info.keyName ? (
        <Label label="API key" hint={setup.secrets[info.keyName] ? "A key is saved. Leave blank to keep it." : undefined}>
          <Input type="password" autoComplete="off" {...setup.sec(info.keyName)} />
        </Label>
      ) : null}
      <ModelBoxes entry={entry} onChange={onChange} reloadKey={setup.reloadKey} />
      <TestButton target={`ai:${entry.kind}`} before={async () => { await setup.saveAll(); setup.bumpModels(); }} after={setup.reload} />
    </div>
  );
}

function ChainRow({ entry, index, count, live, setup, onChange, onMove, expanded, onToggle }: RowProps) {
  const info = AI_CATALOG[entry.kind];
  return (
    <li className="grid gap-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-xs font-bold text-muted">{index + 1}.</span>
        <Button small onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</Button>
        <Button small onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down">↓</Button>
        <Check label="" checked={entry.enabled} onChange={(e) => onChange({ ...entry, enabled: e.target.checked })} aria-label={`Use ${info.name}`} />
        <b>{info.name}</b>
        <ChainTag kind={entry.kind} st={live?.status.find((x) => x.kind === entry.kind)} found={live?.found} />
        <span className="ml-auto" />
        <Button small onClick={onToggle}>{expanded ? "Close" : "Set up"}</Button>
      </div>
      <span className="pl-7 text-sm text-muted">{info.about}</span>
      {expanded ? <ChainSetup entry={entry} setup={setup} onChange={onChange} /> : null}
    </li>
  );
}

/** Swaps two neighbouring entries; out-of-range moves do nothing. */
function moved(chain: ChainEntry[], i: number, d: -1 | 1): ChainEntry[] | null {
  const j = i + d;
  if (j < 0 || j >= chain.length) return null;
  const next = [...chain];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function AiChainCard({ state, secrets, sec, saveAll }: { state: SettingsState; secrets: SecretStatus; sec: SecretInput; saveAll: () => Promise<void> }) {
  const { settings, setSettings } = state;
  const { data: live, reload } = useLoad<ChainState>("/api/settings/ai-providers", 15_000);
  const [open, setOpen] = useState<AiKind | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { busy, run } = useAction();
  if (!settings) return null;
  const chain = settings.ai.chain;
  const setChain = (next: ChainEntry[]) => setSettings({ ...settings, ai: { ...settings.ai, chain: next } });
  const bumpModels = () => setReloadKey((k) => k + 1);
  const setup = { secrets, sec, saveAll, reload, reloadKey, bumpModels };
  const save = () => run("ai-save", async () => { await saveAll(); await reload(); bumpModels(); return "Saved"; });
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
      <UsageLine chain={chain} live={live} />
      <ol className="grid gap-2">
        {chain.map((entry, i) => (
          <ChainRow key={entry.kind} entry={entry} index={i} count={chain.length} live={live} setup={setup}
            expanded={open === entry.kind} onToggle={() => setOpen(open === entry.kind ? null : entry.kind)}
            onChange={(e) => setChain(chain.map((x) => (x.kind === e.kind ? e : x)))}
            onMove={(d) => { const next = moved(chain, i, d); if (next) setChain(next); }} />
        ))}
      </ol>
    </Card>
  );
}
