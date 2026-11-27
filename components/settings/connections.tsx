"use client";

import { useState } from "react";
import { Card, Input, Label, Tag } from "@/components/ui";
import type { Secrets } from "@/lib/settings";
import { AiChainCard, type SecretInput } from "./ai-chain";
import { A, H, P, TestButton } from "./bits";
import type { SecretStatus, SettingsState } from "./state";

type CardProps = { s: SecretStatus; sec: SecretInput; saveAll: () => Promise<void> };

const Saved = ({ ok }: { ok: boolean }) => (ok ? <Tag tone="good">Saved</Tag> : <Tag tone="warn">Not set</Tag>);

/** A password box that keeps the saved value when left blank. */
function SecretField({ label, name, saved, sec, placeholder, savedHint = "Saved. Leave blank to keep it." }: {
  label: string; name: keyof Secrets; saved: boolean; sec: SecretInput; placeholder?: string; savedHint?: string;
}) {
  return (
    <Label label={label} hint={saved ? savedHint : undefined}>
      <Input type="password" autoComplete="off" placeholder={placeholder} {...sec(name)} />
    </Label>
  );
}

function ApifyCard({ s, sec, saveAll }: CardProps) {
  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between"><H>Apify (finds jobs and company contacts)</H><Saved ok={s.apifyToken} /></div>
      <P>Create a free account at <A href="https://console.apify.com/sign-up">apify.com</A>, then copy your token from <A href="https://console.apify.com/settings/integrations">Settings → API &amp; Integrations</A>. The free plan includes about $5 of usage a month.</P>
      <SecretField label="Apify API token" name="apifyToken" saved={s.apifyToken} sec={sec} placeholder="apify_api_…" savedHint="A token is saved. Leave blank to keep it." />
      <TestButton target="apify" before={saveAll} />
    </Card>
  );
}

function BoardKeysCard({ s, sec }: CardProps) {
  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between"><H>Job board keys (free)</H><Saved ok={s.adzunaKey || s.reedKey || s.joobleKey} /></div>
      <P>Each board gives a free key when you sign up: <A href="https://developer.adzuna.com/signup">Adzuna</A> (US, UK and 17 more countries), <A href="https://www.reed.co.uk/developers/jobseeker">Reed</A> (UK) and <A href="https://jooble.org/api/about">Jooble</A> (about 70 countries). A board without a key is skipped. Turn boards on or off under Search → Where to look.</P>
      <div className="grid gap-3 sm:grid-cols-2">
        <SecretField label="Adzuna app ID" name="adzunaAppId" saved={s.adzunaAppId} sec={sec} placeholder="e.g. 1a2b3c4d" />
        <SecretField label="Adzuna app key" name="adzunaKey" saved={s.adzunaKey} sec={sec} placeholder="32 letters and numbers" />
        <SecretField label="Reed API key" name="reedKey" saved={s.reedKey} sec={sec} placeholder="xxxxxxxx-xxxx-…" />
        <SecretField label="Jooble API key" name="joobleKey" saved={s.joobleKey} sec={sec} placeholder="xxxxxxxx-xxxx-…" />
      </div>
    </Card>
  );
}

function GmailCard({ s, sec, saveAll }: CardProps) {
  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between"><H>Gmail (sends your applications, spots replies)</H><Saved ok={!!s.gmailUser && s.gmailAppPassword} /></div>
      <P>Turn on 2-Step Verification for your Google account, then create an app password at <A href="https://myaccount.google.com/apppasswords">myaccount.google.com/apppasswords</A>. It is 16 letters and only works for mail.</P>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Gmail address"><Input type="email" autoComplete="off" placeholder={s.gmailUser || "you@gmail.com"} {...sec("gmailUser")} /></Label>
        <SecretField label="App password" name="gmailAppPassword" saved={s.gmailAppPassword} sec={sec} placeholder="abcd efgh ijkl mnop" />
      </div>
      <TestButton target="gmail" before={saveAll} />
    </Card>
  );
}

function ApolloCard({ s, sec, saveAll }: CardProps) {
  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between"><H>Apollo (optional: named people and verified emails)</H><Saved ok={s.apolloKey} /></div>
      <P>Without Apollo, JobPilot uses emails published on company websites. With an <A href="https://app.apollo.io/#/settings/integrations/api">Apollo API key</A> it also looks up founders and recruiters. Each revealed email uses one Apollo credit (two people per company at most).</P>
      <SecretField label="Apollo API key" name="apolloKey" saved={s.apolloKey} sec={sec} savedHint="A key is saved. Leave blank to keep it." />
      <TestButton target="apollo" before={saveAll} />
    </Card>
  );
}

export function ConnectionsSection({ state }: { state: SettingsState }) {
  const { data, settings, save } = state;
  const [secrets, setSecrets] = useState<Partial<Secrets>>({});
  if (!data || !settings) return null;
  const sec: SecretInput = (k) => ({
    value: secrets[k] ?? "",
    onChange: (e) => setSecrets((x) => ({ ...x, [k]: e.target.value })),
  });
  const saveAll = async () => {
    await save({ settings, secrets });
    setSecrets({});
  };
  const cards: CardProps = { s: data.secrets, sec, saveAll };
  return (
    <div className="grid gap-4">
      <AiChainCard state={state} secrets={data.secrets} sec={sec} saveAll={saveAll} />
      <ApifyCard {...cards} />
      <BoardKeysCard {...cards} />
      <GmailCard {...cards} />
      <ApolloCard {...cards} />
    </div>
  );
}
