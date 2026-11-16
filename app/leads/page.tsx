"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useRuns } from "@/components/shell";
import {
  Button, Check, Drawer, fitTone, Input, Label, LinkButton, Notice, PageHeader, Select, Stat,
  Tag, Textarea, useAction, useToast,
} from "@/components/ui";
import { api, copyText, fmtDate, timeInfo, useLoad } from "@/lib/client";
import { CALL_OUTCOMES, CONTACT_STATUSES } from "@/lib/fields";

type Contact = {
  id: string; companyId: string | null; company: string | null; name: string; title: string | null;
  email: string | null; emailStatus: string | null; phone: string | null; linkedin: string | null;
  timezone: string | null; status: string; optedOut: boolean; source: string | null; notes: string | null;
  lastContacted: string | null; nextFollowUp: string | null;
};
type Lead = {
  id: string; name: string; website: string | null; linkedin: string | null; size: string | null;
  industry: string | null; location: string | null; address: string | null; phone: string | null;
  about: string | null; stack: string | null; enrichedAt: string | null; leadScore: number;
  contacts: Contact[];
  jobs: { id: string; role: string; link: string | null; status: string; fit: string | null; score: number | null; location: string | null; hasDraft: boolean }[];
  calls: { id: string; contactId: string | null; outcome: string; note: string | null; createdAt: string }[];
  emails: { id: string; to: string; status: string; sentAt: string | null; repliedAt: string | null }[];
};
type Settings = { settings: { outreach: { callScript: string } }; profile: { name: string; headline: string } };

const dial = (phone: string) => {
  const t = phone.trim();
  const digits = t.replace(/[^\d]/g, "");
  return (t.startsWith("+") ? "+" : "") + digits;
};
const emptyContact = (lead?: Lead): Partial<Contact> => ({
  name: "", title: "", company: lead?.name ?? "", companyId: lead?.id ?? null, email: "", emailStatus: "",
  phone: "", linkedin: "", timezone: "", status: "To contact", optedOut: false, notes: "",
});

export default function LeadsPage() {
  const { data, error, reload } = useLoad<{ leads: Lead[]; orphanContacts: Contact[] }>("/api/leads");
  const { data: cfg } = useLoad<Settings>("/api/settings");
  const { finishedTick } = useRuns();
  const toast = useToast();
  const { busy, run } = useAction();

  const [q, setQ] = useState("");
  const [onlyEmail, setOnlyEmail] = useState(false);
  const [onlyPhone, setOnlyPhone] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [calling, setCalling] = useState<{ lead: Lead; contact: Contact | null; phone: string } | null>(null);
  const [outcome, setOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const visible = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return leads.filter((l) => {
      const openJobs = l.jobs.filter((j) => !["Rejected", "Skipped"].includes(j.status));
      if (onlyOpen && !openJobs.length && !l.contacts.length) return false;
      if (onlyEmail && !l.contacts.some((c) => c.email)) return false;
      if (onlyPhone && !l.phone && !l.contacts.some((c) => c.phone)) return false;
      if (!needle) return true;
      return [l.name, l.industry, l.location, ...l.contacts.map((c) => `${c.name} ${c.title} ${c.email}`), ...l.jobs.map((j) => j.role)]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [leads, q, onlyEmail, onlyPhone, onlyOpen]);

  const totals = useMemo(() => {
    const contacts = leads.flatMap((l) => l.contacts);
    return {
      companies: leads.length,
      contacts: contacts.length,
      email: contacts.filter((c) => c.email).length,
      phone: leads.filter((l) => l.phone || l.contacts.some((c) => c.phone)).length,
      emailed: leads.filter((l) => l.emails.some((e) => e.status === "sent")).length,
      calls: leads.reduce((n, l) => n + l.calls.length, 0),
      replies: leads.filter((l) => l.emails.some((e) => e.repliedAt)).length,
    };
  }, [leads]);

  const script = (lead: Lead, contact: Contact | null) => {
    const job = lead.jobs.find((j) => !["Rejected", "Skipped"].includes(j.status));
    const first = contact && !/team|inbox/i.test(contact.name) ? contact.name.split(" ")[0] : "there";
    return (cfg?.settings.outreach.callScript ?? "")
      .replaceAll("{contact}", first)
      .replaceAll("{me}", cfg?.profile.name || "[your name]")
      .replaceAll("{company}", lead.name)
      .replaceAll("{role}", job?.role ?? "an engineering role")
      .replaceAll("{pitch}", cfg?.profile.headline ? `I'm a ${cfg.profile.headline}.` : "");
  };

  const writeEmail = (contact: Contact) =>
    run(`email-${contact.id}`, async () => {
      await api("/api/outbox", { body: { contactId: contact.id } });
      await reload();
      return "Email written. Review it in the Outbox.";
    });

  const saveContact = () =>
    run("save-contact", async () => {
      if (!editing) return;
      if (editing.id) await api(`/api/contacts/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: editing });
      else await api("/api/contacts", { body: editing });
      await reload();
      setEditing(null);
      return "Saved";
    });

  const logCall = () =>
    run("log-call", async () => {
      if (!calling) return;
      await api("/api/calls", {
        body: { contactId: calling.contact?.id, companyId: calling.lead.id, phone: calling.phone, outcome, note },
      });
      setNote("");
      await reload();
      setCalling(null);
      return "Call logged";
    });

  const setField = (k: keyof Contact) => (e: { target: { value: string } }) =>
    setEditing((c) => (c ? { ...c, [k]: e.target.value } : c));

  if (error) return <Notice title="Could not load leads" tone="bad">{error}</Notice>;

  return (
    <>
      <PageHeader title="Leads" sub="Companies ranked by how worth contacting they are right now: fit, a way to reach them, open roles.">
        <Button variant="primary" onClick={() => setEditing(emptyContact())}>+ Add contact</Button>
      </PageHeader>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
        <Stat label="Companies" value={totals.companies} />
        <Stat label="Contacts" value={totals.contacts} />
        <Stat label="With email" value={totals.email} />
        <Stat label="Can call" value={totals.phone} />
        <Stat label="Emailed" value={totals.emailed} />
        <Stat label="Calls logged" value={totals.calls} />
        <Stat label="Replied" value={totals.replies} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Input type="search" placeholder="Search company, person, role…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs flex-1" aria-label="Search leads" />
        <Check label="Has email" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} />
        <Check label="Has phone" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} />
        <Check label="Hide companies with nothing open" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
      </div>

      {!data ? <Notice title="Loading leads…" /> : !visible.length ? (
        <Notice title="No leads match">Run “Find new jobs”, or clear the filters above.</Notice>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11px] tracking-wider text-muted uppercase">
                <th className="w-10 px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Company</th>
                <th className="w-36 px-3 py-2.5">Lead score</th>
                <th className="px-3 py-2.5">Open roles</th>
                <th className="px-3 py-2.5">Reach</th>
                <th className="px-3 py-2.5">Last touch</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((lead, i) => {
                const openJobs = lead.jobs.filter((j) => !["Rejected", "Skipped"].includes(j.status));
                const best = [...openJobs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
                const emailContact = lead.contacts.find((c) => c.email && !c.optedOut);
                const phoneContact = lead.contacts.find((c) => c.phone && !c.optedOut) ?? null;
                const phone = phoneContact?.phone ?? lead.phone;
                const lastCall = lead.calls[0];
                const lastEmail = lead.emails.filter((e) => e.sentAt).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))[0];
                const isOpen = expanded === lead.id;
                return (
                  <Fragment key={lead.id}>
                    <tr className={"border-b border-line align-top " + (isOpen ? "bg-sunk/60" : "hover:bg-sunk/40")}>
                      <td className="px-3 py-3 font-mono text-xs text-muted">{i + 1}</td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => setExpanded(isOpen ? null : lead.id)} aria-expanded={isOpen} className="text-left font-bold hover:text-accent">
                          {isOpen ? "▾" : "▸"} {lead.name}
                        </button>
                        <div className="text-xs text-muted">
                          {[lead.industry, lead.size && `${lead.size} people`, lead.location].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunk">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${lead.leadScore}%` }} />
                          </div>
                          <b className="w-7 text-right tabular-nums">{lead.leadScore}</b>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {best ? (
                          <div className="grid gap-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Tag tone={fitTone(best.fit)}>{best.fit ?? "Not scored"}</Tag>
                              <span className="break-words">{best.role}</span>
                            </span>
                            {openJobs.length > 1 ? <span className="text-xs text-muted">+{openJobs.length - 1} more</span> : null}
                          </div>
                        ) : <span className="text-muted">None open</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {emailContact ? <Tag tone={emailContact.emailStatus === "verified" ? "good" : "accent"}>✉ {emailContact.emailStatus ?? "email"}</Tag> : null}
                          {phone ? <Tag tone="good">☎ phone</Tag> : null}
                          {lead.contacts.some((c) => c.linkedin) ? <Tag>in</Tag> : null}
                          {lead.contacts.length && lead.contacts.every((c) => c.optedOut) ? (
                            <Tag tone="bad">Do not contact</Tag>
                          ) : !emailContact && !phone ? (
                            <span className="text-xs text-muted">{lead.enrichedAt ? "Nothing public found" : "Not looked up"}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted">
                        {lastEmail?.repliedAt ? <Tag tone="good">Replied</Tag> : null}
                        {lastEmail ? <div>Emailed {fmtDate(lastEmail.sentAt)}</div> : null}
                        {lastCall ? <div>Called {fmtDate(lastCall.createdAt)} · {lastCall.outcome}</div> : null}
                        {!lastEmail && !lastCall ? "–" : null}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {phone ? (
                            <Button small onClick={() => { setCalling({ lead, contact: phoneContact, phone }); setOutcome(CALL_OUTCOMES[0]); }}>
                              ☎ Call
                            </Button>
                          ) : null}
                          {emailContact ? (
                            <Button small variant="primary" busy={busy === `email-${emailContact.id}`} onClick={() => writeEmail(emailContact)} disabled={!openJobs.length}>
                              ✉ Email
                            </Button>
                          ) : (
                            <Button
                              small
                              busy={busy === `enrich-${lead.id}`}
                              onClick={() =>
                                run(`enrich-${lead.id}`, async () => {
                                  const r = await api<{ ok: boolean; log: string[] }>(`/api/companies/${encodeURIComponent(lead.id)}/enrich`, { method: "POST" });
                                  await reload();
                                  return r.ok ? "Lookup finished." : r.log.at(-1) ?? "Lookup did not run.";
                                })
                              }
                            >
                              Find contacts
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-line bg-sunk/60">
                        <td />
                        <td colSpan={6} className="px-3 pt-1 pb-4">
                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="grid content-start gap-1.5 text-sm">
                              <h3 className="text-xs font-bold tracking-wider text-muted uppercase">Company</h3>
                              {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{lead.website.replace(/^https?:\/\//, "")}</a> : <span className="text-muted">No website known</span>}
                              {lead.linkedin ? <a href={lead.linkedin} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">LinkedIn page</a> : null}
                              {lead.phone ? <span className="font-mono">{lead.phone}</span> : null}
                              {lead.address ? <span>{lead.address}</span> : null}
                              {lead.about ? <p className="text-muted">{lead.about}</p> : null}
                              {lead.stack ? <span>Stack: {lead.stack}</span> : null}
                            </div>
                            <div className="grid content-start gap-1.5 text-sm">
                              <h3 className="text-xs font-bold tracking-wider text-muted uppercase">Roles you can apply to</h3>
                              {lead.jobs.length ? lead.jobs.map((j) => (
                                <div key={j.id} className="flex flex-wrap items-center gap-1.5">
                                  <Tag tone={fitTone(j.fit)}>{j.fit ?? "?"}</Tag>
                                  <Link href={`/jobs?open=${encodeURIComponent(j.id)}`} className="font-semibold hover:text-accent">{j.role}</Link>
                                  <Tag>{j.status}</Tag>
                                  {j.link ? <a href={j.link} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-accent">listing ↗</a> : null}
                                </div>
                              )) : <span className="text-muted">No roles tracked.</span>}
                            </div>
                            <div className="grid content-start gap-2 text-sm">
                              <div className="flex items-center justify-between">
                                <h3 className="text-xs font-bold tracking-wider text-muted uppercase">People</h3>
                                <Button small onClick={() => setEditing(emptyContact(lead))}>+ Add</Button>
                              </div>
                              {lead.contacts.length ? lead.contacts.map((c) => {
                                const t = timeInfo(c.timezone);
                                return (
                                  <div key={c.id} className="grid gap-1 rounded-lg border border-line bg-surface p-2.5">
                                    <div className="flex flex-wrap items-baseline gap-1.5">
                                      <button type="button" onClick={() => setEditing(c)} className="font-bold hover:text-accent">{c.name}</button>
                                      {c.title ? <span className="text-xs text-muted">{c.title}</span> : null}
                                      {c.optedOut ? <Tag tone="bad">Do not contact</Tag> : <Tag>{c.status}</Tag>}
                                    </div>
                                    {c.email ? (
                                      <button type="button" className="text-left font-mono text-xs break-all hover:text-accent" title="Copy" onClick={async () => toast((await copyText(c.email!)) ? "Email copied" : c.email!)}>
                                        {c.email} {c.emailStatus ? `(${c.emailStatus})` : ""}
                                      </button>
                                    ) : null}
                                    {c.phone ? <span className="font-mono text-xs">{c.phone}</span> : null}
                                    {t ? <span className="text-xs text-muted">Their time: {t.local}{t.good ? " · good time to call" : ""}</span> : null}
                                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                                      {c.phone && !c.optedOut ? <Button small onClick={() => { setCalling({ lead, contact: c, phone: c.phone! }); setOutcome(CALL_OUTCOMES[0]); }}>☎ Call</Button> : null}
                                      {c.email && !c.optedOut ? <Button small busy={busy === `email-${c.id}`} onClick={() => writeEmail(c)}>✉ Write email</Button> : null}
                                      {c.linkedin ? <LinkButton small href={c.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn ↗</LinkButton> : null}
                                    </div>
                                  </div>
                                );
                              }) : <span className="text-muted">No people yet. Use “Find contacts” or add one.</span>}
                              {lead.calls.length ? (
                                <ul className="grid gap-1 text-xs text-muted">
                                  {lead.calls.slice(0, 4).map((c) => (
                                    <li key={c.id} className="border-l-2 border-line pl-2">
                                      {fmtDate(c.createdAt)} · <b className="text-fg">{c.outcome}</b>{c.note ? ` · ${c.note}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Call panel */}
      <Drawer
        title={calling ? `Call ${calling.contact?.name ?? calling.lead.name}` : ""}
        open={!!calling}
        onClose={() => setCalling(null)}
        footer={
          <>
            <span className="flex-1" />
            <Button onClick={() => setCalling(null)}>Close</Button>
            <Button variant="primary" busy={busy === "log-call"} onClick={logCall}>Log call</Button>
          </>
        }
      >
        {calling ? (
          <>
            <div className="font-mono text-2xl font-medium tracking-wide break-all">{calling.phone}</div>
            <div className="flex flex-wrap gap-2">
              <LinkButton primary href={`zoomphonecall://${encodeURIComponent(dial(calling.phone))}`}>☎ Call with Zoom Phone</LinkButton>
              <LinkButton href={`tel:${dial(calling.phone)}`}>Other phone app</LinkButton>
              <Button onClick={async () => toast((await copyText(dial(calling.phone))) ? "Number copied" : calling.phone)}>Copy</Button>
            </div>
            <p className="text-xs text-muted">
              The first time, your browser asks to open Zoom; tick “Always allow”. Zoom Phone must be signed in on this computer.
            </p>
            {(() => {
              const t = timeInfo(calling.contact?.timezone);
              return t ? <Tag tone={t.good ? "good" : "warn"}>Their time: {t.local}{t.good ? "" : " · outside 10am–5pm"}</Tag> : null;
            })()}
            <div className="rounded-lg bg-sunk p-3 text-sm whitespace-pre-wrap">{script(calling.lead, calling.contact)}</div>
            <Label label="Outcome">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
              </Select>
            </Label>
            <Label label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said, next step…" /></Label>
          </>
        ) : null}
      </Drawer>

      {/* Contact editor */}
      <Drawer
        title={editing?.id ? editing.name ?? "Contact" : "Add contact"}
        open={!!editing}
        onClose={() => setEditing(null)}
        footer={
          <>
            {editing?.id ? (
              <Button
                variant="danger"
                onClick={() => {
                  if (!window.confirm(`Delete ${editing.name}?`)) return;
                  void run("del-contact", async () => {
                    await api(`/api/contacts/${encodeURIComponent(editing.id!)}`, { method: "DELETE" });
                    await reload();
                    setEditing(null);
                    return "Deleted";
                  });
                }}
              >
                Delete
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" busy={busy === "save-contact"} onClick={saveContact} disabled={!editing?.name?.trim()}>Save</Button>
          </>
        }
      >
        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label label="Name"><Input value={editing.name ?? ""} onChange={setField("name")} /></Label>
              <Label label="Title"><Input value={editing.title ?? ""} onChange={setField("title")} placeholder="Founder, CTO, Recruiter…" /></Label>
            </div>
            <Label label="Company"><Input value={editing.company ?? ""} onChange={setField("company")} disabled={!!editing.id} /></Label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label label="Email"><Input type="email" value={editing.email ?? ""} onChange={setField("email")} /></Label>
              <Label label="Email status">
                <Select value={editing.emailStatus ?? ""} onChange={setField("emailStatus")}>
                  <option value="">Unknown</option>
                  <option value="verified">verified</option>
                  <option value="site">site (found on their website)</option>
                  <option value="guessed">guessed</option>
                </Select>
              </Label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Label label="Phone" hint="Include the country code, e.g. +1 415 555 0100"><Input value={editing.phone ?? ""} onChange={setField("phone")} /></Label>
              <Label label="Time zone" hint="e.g. America/New_York"><Input value={editing.timezone ?? ""} onChange={setField("timezone")} /></Label>
            </div>
            <Label label="LinkedIn"><Input type="url" value={editing.linkedin ?? ""} onChange={setField("linkedin")} placeholder="https://" /></Label>
            <Label label="Status">
              <Select value={editing.status ?? "To contact"} onChange={setField("status")}>
                {CONTACT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Label>
            <Label label="Notes"><Textarea value={editing.notes ?? ""} onChange={setField("notes")} /></Label>
            <Check
              label="Asked not to be contacted"
              checked={!!editing.optedOut}
              onChange={(e) => setEditing((c) => (c ? { ...c, optedOut: e.target.checked } : c))}
            />
          </>
        ) : null}
      </Drawer>
    </>
  );
}
