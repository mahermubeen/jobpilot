"use client";

import { useRef, useState } from "react";
import { Button, Card, Input, Label, Textarea, useAction } from "@/components/ui";
import { api } from "@/lib/client";
import type { Profile } from "@/lib/cv/types";
import { H, lines, P } from "./bits";
import type { SettingsState } from "./state";

type Job = Profile["experience"][number];
type Set = (p: Partial<Profile>) => void;
type Drafts = Record<string, string>;
type Edit = (k: string, parse: (v: string) => Partial<Profile>) => { value: string; onChange: (e: { target: { value: string } }) => void };

const splitBar = (line: string, n: number) => {
  const parts = line.split("|").map((p) => p.trim());
  return Array.from({ length: n }, (_, i) => parts[i] ?? "");
};
const items = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// The free-text boxes, one line per entry, parsed back into the profile.
const parseLinks = (v: string) => ({ links: lines(v).map((l) => { const [label, url] = splitBar(l, 2); return { label, url }; }).filter((l) => l.url) });
const parseProjects = (v: string) => ({
  projects: lines(v).map((l) => { const [name, description, tech, url] = splitBar(l, 4); return { name, description, tech, url }; }).filter((p) => p.name),
});
const skillLine = (l: string) => {
  const at = l.indexOf(":");
  return at === -1 ? { category: "Skills", items: items(l) } : { category: l.slice(0, at).trim(), items: items(l.slice(at + 1)) };
};
const parseSkills = (v: string) => ({ skills: lines(v).map(skillLine).filter((s) => s.items.length) });
const parseEducation = (v: string) => ({
  education: lines(v).map((l) => { const [school, degree, start, end] = splitBar(l, 4); return { school, degree, start, end }; }).filter((e) => e.school),
});

/** The free-text boxes as they read for a profile. */
const draftsOf = (profile: Profile): Drafts => ({
  links: profile.links.map((l) => `${l.label} | ${l.url}`).join("\n"),
  projects: profile.projects.map((p) => [p.name, p.description, p.tech, p.url].join(" | ")).join("\n"),
  skills: profile.skills.map((s) => `${s.category}: ${s.items.join(", ")}`).join("\n"),
  education: profile.education.map((e) => [e.school, e.degree, e.start, e.end].join(" | ")).join("\n"),
});

function UploadCard({ onParsed }: { onParsed: (p: Profile) => void }) {
  const { busy, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const upload = (f: File) =>
    run("parse", async () => {
      const form = new FormData();
      form.append("file", f);
      const r = await api<{ profile: Profile }>("/api/profile/parse", { form });
      onParsed(r.profile);
      return "CV read. Check every field below, then save.";
    });
  return (
    <Card className="grid gap-3">
      <H>Your master CV</H>
      <P>Tailored CVs only ever select and reorder what is written here. They never add experience, tools or numbers, so keep this complete and accurate.</P>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <Button busy={busy === "parse"} onClick={() => file.current?.click()}>Fill from a CV file (PDF)</Button>
        <span className="text-xs text-muted">Uses Claude to read the file. Takes up to a minute.</span>
      </div>
    </Card>
  );
}

function BasicsCard({ profile, set, edit }: { profile: Profile; set: Set; edit: Edit }) {
  return (
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
        <Textarea {...edit("links", parseLinks)} placeholder={"LinkedIn | https://linkedin.com/in/you\nGitHub | https://github.com/you"} />
      </Label>
      <Label label="Summary (optional)"><Textarea value={profile.summary} onChange={(e) => set({ summary: e.target.value })} /></Label>
    </Card>
  );
}

function JobEditor({ e, setExp, remove }: { e: Job; setExp: (p: Partial<Job>) => void; remove: () => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Label label="Company"><Input value={e.company} onChange={(ev) => setExp({ company: ev.target.value })} /></Label>
        <Label label="Title"><Input value={e.title} onChange={(ev) => setExp({ title: ev.target.value })} /></Label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Label label="Location"><Input value={e.location} onChange={(ev) => setExp({ location: ev.target.value })} /></Label>
        <Label label="Start"><Input value={e.start} onChange={(ev) => setExp({ start: ev.target.value })} placeholder="Jan 2025" /></Label>
        <Label label="End"><Input value={e.end} onChange={(ev) => setExp({ end: ev.target.value })} placeholder="Present" /></Label>
      </div>
      <Label label="Bullets, one per line">
        <Textarea className="min-h-36" value={e.bullets.join("\n")} onChange={(ev) => setExp({ bullets: ev.target.value.split("\n") })} onBlur={(ev) => setExp({ bullets: lines(ev.target.value) })} />
      </Label>
      <div><Button small variant="danger" onClick={remove}>Remove this job</Button></div>
    </div>
  );
}

const emptyJob = (): Job => ({ company: "", title: "", location: "", start: "", end: "", bullets: [] });

function ExperienceCard({ profile, set }: { profile: Profile; set: Set }) {
  const setExp = (i: number, p: Partial<Job>) => set({ experience: profile.experience.map((e, n) => (n === i ? { ...e, ...p } : e)) });
  return (
    <Card className="grid gap-3">
      <H>Experience</H>
      {profile.experience.map((e, i) => (
        <JobEditor key={i} e={e} setExp={(p) => setExp(i, p)} remove={() => set({ experience: profile.experience.filter((_, n) => n !== i) })} />
      ))}
      <div><Button small onClick={() => set({ experience: [...profile.experience, emptyJob()] })}>+ Add job</Button></div>
    </Card>
  );
}

function ExtrasCard({ edit }: { edit: Edit }) {
  return (
    <Card className="grid gap-3">
      <H>Projects, skills, education</H>
      <Label label="Projects, one per line: Name | Description | Tech | URL">
        <Textarea {...edit("projects", parseProjects)} />
      </Label>
      <Label label="Skills, one group per line: Category: skill, skill, skill">
        <Textarea className="min-h-36" {...edit("skills", parseSkills)} />
      </Label>
      <Label label="Education, one per line: School | Degree | Start | End">
        <Textarea {...edit("education", parseEducation)} />
      </Label>
    </Card>
  );
}

export function ProfileSection({ state }: { state: SettingsState }) {
  const { profile, setProfile } = state;
  // Free-text editors keep their own draft so typing "|" or a newline is never fought by re-parsing.
  const [text, setText] = useState<Drafts | null>(null);
  if (profile && !text) setText(draftsOf(profile));
  if (!profile || !text) return null;
  const set: Set = (p) => setProfile({ ...profile, ...p });
  const edit: Edit = (k, parse) => ({
    value: text[k],
    onChange: (e) => {
      setText({ ...text, [k]: e.target.value });
      set(parse(e.target.value));
    },
  });
  const onParsed = (p: Profile) => {
    setProfile(p);
    setText(null);
  };
  return (
    <div className="grid gap-4">
      <UploadCard onParsed={onParsed} />
      <BasicsCard profile={profile} set={set} edit={edit} />
      <ExperienceCard profile={profile} set={set} />
      <ExtrasCard edit={edit} />
    </div>
  );
}
