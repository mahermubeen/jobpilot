"use client";

import { useEffect, useMemo, useState } from "react";
import { CallDrawer, ContactDrawer } from "@/components/leads/drawers";
import {
  type Calling, callScript, type Contact, emptyContact, type Filters, filterLeads, type Lead, leadTotals, type LeadSettings,
} from "@/components/leads/model";
import { type LeadActions, LeadsTable } from "@/components/leads/table";
import { useRuns } from "@/components/shell";
import { Button, Check, Input, Notice, PageHeader, Stat, useAction, useToast } from "@/components/ui";
import { api, copyText, useLoad } from "@/lib/client";
import { CALL_OUTCOMES } from "@/lib/fields";

type Run = ReturnType<typeof useAction>["run"];
type Ctx = { run: Run; reload: () => Promise<unknown> };
type Editing = Partial<Contact> | null;

const contactUrl = (id: string) => `/api/contacts/${encodeURIComponent(id)}`;

function Totals({ leads }: { leads: Lead[] }) {
  const t = useMemo(() => leadTotals(leads), [leads]);
  const stats: [string, number][] = [
    ["Companies", t.companies], ["Contacts", t.contacts], ["With email", t.email], ["Can call", t.phone],
    ["Emailed", t.emailed], ["Calls logged", t.calls], ["Replied", t.replies],
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
      {stats.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
    </div>
  );
}

function FilterBar({ f, set }: { f: Filters; set: (p: Partial<Filters>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Input type="search" placeholder="Search company, person, role…" value={f.q} onChange={(e) => set({ q: e.target.value })} className="max-w-xs flex-1" aria-label="Search leads" />
      <Check label="Has email" checked={f.onlyEmail} onChange={(e) => set({ onlyEmail: e.target.checked })} />
      <Check label="Has phone" checked={f.onlyPhone} onChange={(e) => set({ onlyPhone: e.target.checked })} />
      <Check label="Hide companies with nothing open" checked={f.onlyOpen} onChange={(e) => set({ onlyOpen: e.target.checked })} />
    </div>
  );
}

/** The call drawer's state: who is being called, the outcome picked and the note. */
function useCall({ run, reload }: Ctx) {
  const [calling, setCalling] = useState<Calling | null>(null);
  const [outcome, setOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [note, setNote] = useState("");
  const start = (lead: Lead, contact: Contact | null, phone: string) => {
    setCalling({ lead, contact, phone });
    setOutcome(CALL_OUTCOMES[0]);
  };
  const close = () => setCalling(null);
  const logCall = () =>
    run("log-call", async () => {
      if (!calling) return;
      await api("/api/calls", { body: { contactId: calling.contact?.id, companyId: calling.lead.id, phone: calling.phone, outcome, note } });
      setNote("");
      await reload();
      close();
      return "Call logged";
    });
  return { calling, outcome, setOutcome, note, setNote, start, close, logCall };
}

/** The contact editor's state and its save and delete. */
function useContactEditor({ run, reload }: Ctx) {
  const [editing, setEditing] = useState<Editing>(null);
  const save = () =>
    run("save-contact", async () => {
      if (!editing) return;
      if (editing.id) await api(contactUrl(editing.id), { method: "PATCH", body: editing });
      else await api("/api/contacts", { body: editing });
      await reload();
      setEditing(null);
      return "Saved";
    });
  const remove = (c: Partial<Contact>) => {
    if (!c.id || !window.confirm(`Delete ${c.name}?`)) return;
    const id = c.id;
    void run("del-contact", async () => {
      await api(contactUrl(id), { method: "DELETE" });
      await reload();
      setEditing(null);
      return "Deleted";
    });
  };
  return { editing, setEditing, save, remove };
}

function rowActions({ run, reload }: Ctx, extra: Pick<LeadActions, "busy" | "call" | "edit" | "copy">): LeadActions {
  return {
    ...extra,
    writeEmail: (contact) =>
      run(`email-${contact.id}`, async () => {
        await api("/api/outbox", { body: { contactId: contact.id } });
        await reload();
        return "Email written. Review it in the Outbox.";
      }),
    findContacts: (lead) =>
      run(`enrich-${lead.id}`, async () => {
        const r = await api<{ ok: boolean; log: string[] }>(`/api/companies/${encodeURIComponent(lead.id)}/enrich`, { method: "POST" });
        await reload();
        return r.ok ? "Lookup finished." : r.log.at(-1) ?? "Lookup did not run.";
      }),
  };
}

function useLeadsPage() {
  const { data, error, reload } = useLoad<{ leads: Lead[]; orphanContacts: Contact[] }>("/api/leads");
  const { data: cfg } = useLoad<LeadSettings>("/api/settings");
  const { finishedTick } = useRuns();
  const toast = useToast();
  const { busy, run } = useAction();
  const [filters, setFilters] = useState<Filters>({ q: "", onlyEmail: false, onlyPhone: false, onlyOpen: true });
  const [expanded, setExpanded] = useState<string | null>(null);
  const ctx = { run, reload };
  const call = useCall(ctx);
  const contact = useContactEditor(ctx);

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const visible = useMemo(() => filterLeads(leads, filters), [leads, filters]);
  const copy = async (text: string, done: string, shown = text) => toast((await copyText(text)) ? done : shown);
  const actions = rowActions(ctx, { busy, call: call.start, edit: contact.setEditing, copy: (t, d, s) => void copy(t, d, s) });
  const setFilter = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  return { data, error, cfg, busy, leads, visible, filters, setFilter, expanded, setExpanded, call, contact, actions };
}

export default function LeadsPage() {
  const p = useLeadsPage();
  const { call, contact } = p;
  if (p.error) return <Notice title="Could not load leads" tone="bad">{p.error}</Notice>;
  const list = !p.visible.length
    ? <Notice title="No leads match">Run “Find new jobs”, or clear the filters above.</Notice>
    : <LeadsTable leads={p.visible} expanded={p.expanded} setExpanded={p.setExpanded} actions={p.actions} />;
  return (
    <>
      <PageHeader title="Leads" sub="Companies ranked by how worth contacting they are right now: fit, a way to reach them, open roles.">
        <Button variant="primary" onClick={() => contact.setEditing(emptyContact())}>+ Add contact</Button>
      </PageHeader>
      <Totals leads={p.leads} />
      <FilterBar f={p.filters} set={p.setFilter} />
      {p.data ? list : <Notice title="Loading leads…" />}
      <CallDrawer
        {...call}
        busy={p.busy}
        script={call.calling ? callScript(p.cfg, call.calling.lead, call.calling.contact) : ""}
        copy={p.actions.copy}
      />
      <ContactDrawer editing={contact.editing} setEditing={contact.setEditing} busy={p.busy} save={contact.save} remove={contact.remove} />
    </>
  );
}
