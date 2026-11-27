"use client";

import { Fragment } from "react";
import { Button, fitTone, Tag } from "@/components/ui";
import { fmtDate } from "@/lib/client";
import { LeadDetail } from "./detail";
import { type Contact, type Lead, leadReach, type Reach } from "./model";

/** What the rows can do; the page owns the state behind them. */
export type LeadActions = {
  busy: string | null;
  call: (lead: Lead, contact: Contact | null, phone: string) => void;
  writeEmail: (contact: Contact) => void;
  findContacts: (lead: Lead) => void;
  edit: (contact: Partial<Contact>) => void;
  copy: (text: string, done: string, shown?: string) => void;
};

const td = "px-3 py-3";

function CompanyCell({ lead, open, toggle }: { lead: Lead; open: boolean; toggle: () => void }) {
  return (
    <td className={td}>
      <button type="button" onClick={toggle} aria-expanded={open} className="text-left font-bold hover:text-accent">
        {open ? "▾" : "▸"} {lead.name}
      </button>
      <div className="text-xs text-muted">
        {[lead.industry, lead.size && `${lead.size} people`, lead.location].filter(Boolean).join(" · ")}
      </div>
    </td>
  );
}

function ScoreCell({ score }: { score: number }) {
  return (
    <td className={td}>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunk">
          <div className="h-full rounded-full bg-accent" style={{ width: `${score}%` }} />
        </div>
        <b className="w-7 text-right tabular-nums">{score}</b>
      </div>
    </td>
  );
}

function RolesCell({ reach }: { reach: Reach }) {
  const { best, openJobs } = reach;
  if (!best) return <td className={td}><span className="text-muted">None open</span></td>;
  return (
    <td className={td}>
      <div className="grid gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Tag tone={fitTone(best.fit)}>{best.fit ?? "Not scored"}</Tag>
          <span className="break-words">{best.role}</span>
        </span>
        {openJobs.length > 1 ? <span className="text-xs text-muted">+{openJobs.length - 1} more</span> : null}
      </div>
    </td>
  );
}

/** "Do not contact" when everyone opted out, or why there is no way to reach them. */
function NoReach({ lead, reach }: { lead: Lead; reach: Reach }) {
  if (lead.contacts.length && lead.contacts.every((c) => c.optedOut)) return <Tag tone="bad">Do not contact</Tag>;
  if (reach.emailContact || reach.phone) return null;
  return <span className="text-xs text-muted">{lead.enrichedAt ? "Nothing public found" : "Not looked up"}</span>;
}

function ReachCell({ lead, reach }: { lead: Lead; reach: Reach }) {
  const { emailContact } = reach;
  return (
    <td className={td}>
      <div className="flex flex-wrap gap-1">
        {emailContact ? <Tag tone={emailContact.emailStatus === "verified" ? "good" : "accent"}>✉ {emailContact.emailStatus ?? "email"}</Tag> : null}
        {reach.phone ? <Tag tone="good">☎ phone</Tag> : null}
        {lead.contacts.some((c) => c.linkedin) ? <Tag>in</Tag> : null}
        <NoReach lead={lead} reach={reach} />
      </div>
    </td>
  );
}

function LastTouchCell({ reach }: { reach: Reach }) {
  const { lastEmail, lastCall } = reach;
  return (
    <td className={`${td} text-xs text-muted`}>
      {lastEmail?.repliedAt ? <Tag tone="good">Replied</Tag> : null}
      {lastEmail ? <div>Emailed {fmtDate(lastEmail.sentAt)}</div> : null}
      {lastCall ? <div>Called {fmtDate(lastCall.createdAt)} · {lastCall.outcome}</div> : null}
      {!lastEmail && !lastCall ? "–" : null}
    </td>
  );
}

function ActionsCell({ lead, reach, actions }: { lead: Lead; reach: Reach; actions: LeadActions }) {
  const { emailContact, phone, phoneContact } = reach;
  return (
    <td className={td}>
      <div className="flex flex-wrap justify-end gap-1.5">
        {phone ? <Button small onClick={() => actions.call(lead, phoneContact, phone)}>☎ Call</Button> : null}
        {emailContact ? (
          <Button small variant="primary" busy={actions.busy === `email-${emailContact.id}`} onClick={() => actions.writeEmail(emailContact)} disabled={!reach.openJobs.length}>
            ✉ Email
          </Button>
        ) : (
          <Button small busy={actions.busy === `enrich-${lead.id}`} onClick={() => actions.findContacts(lead)}>Find contacts</Button>
        )}
      </div>
    </td>
  );
}

function LeadRow({ lead, rank, open, toggle, actions }: { lead: Lead; rank: number; open: boolean; toggle: () => void; actions: LeadActions }) {
  const reach = leadReach(lead);
  return (
    <Fragment>
      <tr className={"border-b border-line align-top " + (open ? "bg-sunk/60" : "hover:bg-sunk/40")}>
        <td className={`${td} font-mono text-xs text-muted`}>{rank}</td>
        <CompanyCell lead={lead} open={open} toggle={toggle} />
        <ScoreCell score={lead.leadScore} />
        <RolesCell reach={reach} />
        <ReachCell lead={lead} reach={reach} />
        <LastTouchCell reach={reach} />
        <ActionsCell lead={lead} reach={reach} actions={actions} />
      </tr>
      {open ? (
        <tr className="border-b border-line bg-sunk/60">
          <td />
          <td colSpan={6} className="px-3 pt-1 pb-4"><LeadDetail lead={lead} actions={actions} /></td>
        </tr>
      ) : null}
    </Fragment>
  );
}

const HEADINGS: [string, string][] = [
  ["#", "w-10"], ["Company", ""], ["Lead score", "w-36"], ["Open roles", ""], ["Reach", ""], ["Last touch", ""], ["Actions", "text-right"],
];

export function LeadsTable({ leads, expanded, setExpanded, actions }: {
  leads: Lead[]; expanded: string | null; setExpanded: (id: string | null) => void; actions: LeadActions;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[11px] tracking-wider text-muted uppercase">
            {HEADINGS.map(([h, cls]) => <th key={h} className={`${cls} px-3 py-2.5`.trim()}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, i) => {
            const open = expanded === lead.id;
            return <LeadRow key={lead.id} lead={lead} rank={i + 1} open={open} toggle={() => setExpanded(open ? null : lead.id)} actions={actions} />;
          })}
        </tbody>
      </table>
    </div>
  );
}
