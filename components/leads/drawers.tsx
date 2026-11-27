"use client";

import { Button, Check, Drawer, Input, Label, LinkButton, Select, Tag, Textarea } from "@/components/ui";
import { timeInfo } from "@/lib/client";
import { CALL_OUTCOMES, CONTACT_STATUSES } from "@/lib/fields";
import { type Calling, type Contact, dial } from "./model";

type CallProps = {
  calling: Calling | null; script: string; busy: string | null;
  outcome: string; setOutcome: (o: string) => void; note: string; setNote: (n: string) => void;
  close: () => void; logCall: () => void; copy: (text: string, done: string, shown?: string) => void;
};

function TheirTime({ timezone }: { timezone: string | null | undefined }) {
  const t = timeInfo(timezone);
  return t ? <Tag tone={t.good ? "good" : "warn"}>Their time: {t.local}{t.good ? "" : " · outside 10am–5pm"}</Tag> : null;
}

function Dialler({ phone, copy }: { phone: string; copy: CallProps["copy"] }) {
  const n = dial(phone);
  return (
    <>
      <div className="font-mono text-2xl font-medium tracking-wide break-all">{phone}</div>
      <div className="flex flex-wrap gap-2">
        <LinkButton primary href={`zoomphonecall://${encodeURIComponent(n)}`}>☎ Call with Zoom Phone</LinkButton>
        <LinkButton href={`tel:${n}`}>Other phone app</LinkButton>
        <Button onClick={() => copy(n, "Number copied", phone)}>Copy</Button>
      </div>
      <p className="text-xs text-muted">
        The first time, your browser asks to open Zoom; tick “Always allow”. Zoom Phone must be signed in on this computer.
      </p>
    </>
  );
}

/** The call panel: number, dial links, their local time, the script and the outcome log. */
export function CallDrawer({ calling, script, busy, outcome, setOutcome, note, setNote, close, logCall, copy }: CallProps) {
  const footer = (
    <>
      <span className="flex-1" />
      <Button onClick={close}>Close</Button>
      <Button variant="primary" busy={busy === "log-call"} onClick={logCall}>Log call</Button>
    </>
  );
  return (
    <Drawer title={calling ? `Call ${calling.contact?.name ?? calling.lead.name}` : ""} open={!!calling} onClose={close} footer={footer}>
      {calling ? (
        <>
          <Dialler phone={calling.phone} copy={copy} />
          <TheirTime timezone={calling.contact?.timezone} />
          <div className="rounded-lg bg-sunk p-3 text-sm whitespace-pre-wrap">{script}</div>
          <Label label="Outcome">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </Select>
          </Label>
          <Label label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said, next step…" /></Label>
        </>
      ) : null}
    </Drawer>
  );
}

type Editing = Partial<Contact>;
type SetEditing = (f: (c: Editing | null) => Editing | null) => void;

function ContactForm({ editing, setEditing }: { editing: Editing; setEditing: SetEditing }) {
  const field = (k: keyof Contact) => ({
    value: String(editing[k] ?? ""),
    onChange: (e: { target: { value: string } }) => setEditing((c) => (c ? { ...c, [k]: e.target.value } : c)),
  });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Name"><Input {...field("name")} /></Label>
        <Label label="Title"><Input {...field("title")} placeholder="Founder, CTO, Recruiter…" /></Label>
      </div>
      <Label label="Company"><Input {...field("company")} disabled={!!editing.id} /></Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Email"><Input type="email" {...field("email")} /></Label>
        <Label label="Email status">
          <Select {...field("emailStatus")}>
            <option value="">Unknown</option>
            <option value="verified">verified</option>
            <option value="site">site (found on their website)</option>
            <option value="guessed">guessed</option>
          </Select>
        </Label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label label="Phone" hint="Include the country code, e.g. +1 415 555 0100"><Input {...field("phone")} /></Label>
        <Label label="Time zone" hint="e.g. America/New_York"><Input {...field("timezone")} /></Label>
      </div>
      <Label label="LinkedIn"><Input type="url" {...field("linkedin")} placeholder="https://" /></Label>
      <Label label="Status">
        <Select value={editing.status ?? "To contact"} onChange={field("status").onChange}>
          {CONTACT_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Label>
      <Label label="Notes"><Textarea {...field("notes")} /></Label>
      <Check label="Asked not to be contacted" checked={!!editing.optedOut} onChange={(e) => setEditing((c) => (c ? { ...c, optedOut: e.target.checked } : c))} />
    </>
  );
}

/** Add or edit one contact; existing contacts can also be deleted. */
export function ContactDrawer({ editing, setEditing, busy, save, remove }: {
  editing: Editing | null; setEditing: SetEditing; busy: string | null; save: () => void; remove: (c: Editing) => void;
}) {
  const close = () => setEditing(() => null);
  const footer = (
    <>
      {editing?.id ? <Button variant="danger" onClick={() => remove(editing)}>Delete</Button> : null}
      <span className="flex-1" />
      <Button onClick={close}>Cancel</Button>
      <Button variant="primary" busy={busy === "save-contact"} onClick={save} disabled={!editing?.name?.trim()}>Save</Button>
    </>
  );
  return (
    <Drawer title={editing?.id ? editing.name ?? "Contact" : "Add contact"} open={!!editing} onClose={close} footer={footer}>
      {editing ? <ContactForm editing={editing} setEditing={setEditing} /> : null}
    </Drawer>
  );
}
