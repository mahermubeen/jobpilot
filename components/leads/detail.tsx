"use client";

import Link from "next/link";
import { Button, fitTone, LinkButton, Tag } from "@/components/ui";
import { fmtDate, jobLink, timeInfo } from "@/lib/client";
import { type Contact, emptyContact, type Lead, type LeadJob } from "./model";
import type { LeadActions } from "./table";

const heading = "text-xs font-bold tracking-wider text-muted uppercase";
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

function CompanyFacts({ lead }: { lead: Lead }) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <h3 className={heading}>Company</h3>
      {lead.website ? <a href={lead.website} {...ext} className="text-accent hover:underline">{lead.website.replace(/^https?:\/\//, "")}</a> : <span className="text-muted">No website known</span>}
      {lead.linkedin ? <a href={lead.linkedin} {...ext} className="text-accent hover:underline">LinkedIn page</a> : null}
      {lead.phone ? <span className="font-mono">{lead.phone}</span> : null}
      {lead.address ? <span>{lead.address}</span> : null}
      {lead.about ? <p className="text-muted">{lead.about}</p> : null}
      {lead.stack ? <span>Stack: {lead.stack}</span> : null}
    </div>
  );
}

function JobLine({ j }: { j: LeadJob }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag tone={fitTone(j.fit)}>{j.fit ?? "?"}</Tag>
      <Link href={`/jobs?open=${encodeURIComponent(j.id)}`} className="font-semibold hover:text-accent">{j.role}</Link>
      <Tag>{j.status}</Tag>
      {j.link ? <a href={jobLink(j.link, j.id)} {...ext} className="text-xs text-muted hover:text-accent">listing ↗</a> : null}
    </div>
  );
}

function Roles({ lead }: { lead: Lead }) {
  return (
    <div className="grid content-start gap-1.5 text-sm">
      <h3 className={heading}>Roles you can apply to</h3>
      {lead.jobs.length ? lead.jobs.map((j) => <JobLine key={j.id} j={j} />) : <span className="text-muted">No roles tracked.</span>}
    </div>
  );
}

function ContactLines({ c, actions }: { c: Contact; actions: LeadActions }) {
  const t = timeInfo(c.timezone);
  return (
    <>
      {c.email ? (
        <button type="button" className="text-left font-mono text-xs break-all hover:text-accent" title="Copy" onClick={() => actions.copy(c.email!, "Email copied")}>
          {c.email} {c.emailStatus ? `(${c.emailStatus})` : ""}
        </button>
      ) : null}
      {c.phone ? <span className="font-mono text-xs">{c.phone}</span> : null}
      {t ? <span className="text-xs text-muted">Their time: {t.local}{t.good ? " · good time to call" : ""}</span> : null}
    </>
  );
}

function ContactButtons({ lead, c, actions }: { lead: Lead; c: Contact; actions: LeadActions }) {
  const reachable = !c.optedOut;
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {c.phone && reachable ? <Button small onClick={() => actions.call(lead, c, c.phone!)}>☎ Call</Button> : null}
      {c.email && reachable ? <Button small busy={actions.busy === `email-${c.id}`} onClick={() => actions.writeEmail(c)}>✉ Write email</Button> : null}
      {c.linkedin ? <LinkButton small href={c.linkedin} {...ext}>LinkedIn ↗</LinkButton> : null}
    </div>
  );
}

function ContactCard({ lead, c, actions }: { lead: Lead; c: Contact; actions: LeadActions }) {
  return (
    <div className="grid gap-1 rounded-lg border border-line bg-surface p-2.5">
      <div className="flex flex-wrap items-baseline gap-1.5">
        <button type="button" onClick={() => actions.edit(c)} className="font-bold hover:text-accent">{c.name}</button>
        {c.title ? <span className="text-xs text-muted">{c.title}</span> : null}
        {c.optedOut ? <Tag tone="bad">Do not contact</Tag> : <Tag>{c.status}</Tag>}
      </div>
      <ContactLines c={c} actions={actions} />
      <ContactButtons lead={lead} c={c} actions={actions} />
    </div>
  );
}

function RecentCalls({ calls }: { calls: Lead["calls"] }) {
  if (!calls.length) return null;
  return (
    <ul className="grid gap-1 text-xs text-muted">
      {calls.slice(0, 4).map((c) => (
        <li key={c.id} className="border-l-2 border-line pl-2">
          {fmtDate(c.createdAt)} · <b className="text-fg">{c.outcome}</b>{c.note ? ` · ${c.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

function People({ lead, actions }: { lead: Lead; actions: LeadActions }) {
  return (
    <div className="grid content-start gap-2 text-sm">
      <div className="flex items-center justify-between">
        <h3 className={heading}>People</h3>
        <Button small onClick={() => actions.edit(emptyContact(lead))}>+ Add</Button>
      </div>
      {lead.contacts.length
        ? lead.contacts.map((c) => <ContactCard key={c.id} lead={lead} c={c} actions={actions} />)
        : <span className="text-muted">No people yet. Use “Find contacts” or add one.</span>}
      <RecentCalls calls={lead.calls} />
    </div>
  );
}

/** The expanded row: company facts, every tracked role, and the people to reach. */
export function LeadDetail({ lead, actions }: { lead: Lead; actions: LeadActions }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <CompanyFacts lead={lead} />
      <Roles lead={lead} />
      <People lead={lead} actions={actions} />
    </div>
  );
}
