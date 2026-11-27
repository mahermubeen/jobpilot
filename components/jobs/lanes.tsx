"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import { jobLink } from "@/lib/client";
import { JOB_STATUSES } from "@/lib/fields";
import { fitTone, Tag } from "../ui";
import { type BoardCtx, markActive, moveJob } from "./actions";
import type { Selection } from "./hooks";
import { cardDate, DOT, type JobRow, laneJobs } from "./model";

type Drag = { dragId: string | null; setDragId: (id: string | null) => void; overLane: string | null; setOverLane: (f: (l: string | null) => string | null) => void };
type CardProps = { j: JobRow; ctx: BoardCtx; selection: Selection; drag: Drag; onOpen: (j: JobRow) => void };

function CardTags({ j }: { j: JobRow }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {j.fit ? <Tag tone={fitTone(j.fit)}>{j.fit}{j.score != null ? ` ${j.score}` : ""}</Tag> : <Tag>Not scored</Tag>}
      {j.kind === "post" ? <Tag tone="warn">Post · apply by hand</Tag> : null}
      {j.tier ? <Tag tone="accent">{j.tier}</Tag> : null}
      {j.pay ? <Tag>{j.pay.slice(0, 28)}</Tag> : null}
      {(j.flags ?? []).map((f) => (
        <Tag key={f} tone="bad">{f}</Tag>
      ))}
    </div>
  );
}

function CardFooter({ j, ctx }: { j: JobRow; ctx: BoardCtx }) {
  return (
    <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
      <span>
        {j.cover ? "✉ " : ""}
        {j.source ?? ""}
        {j.alsoOn?.length ? <span title={`Also on ${j.alsoOn.join(", ")}`}> +{j.alsoOn.length}</span> : null}
        {cardDate(j)}
      </span>
      <select
        aria-label={`Move ${j.company}`}
        value={j.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => void moveJob(ctx, j.id, e.target.value)}
        className="rounded-md border border-line bg-surface px-1 py-0.5 font-sans text-xs"
      >
        {JOB_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

function CardTitle({ j, selection }: { j: JobRow; selection: Selection }) {
  return (
    <div className="flex items-baseline gap-1.5 text-[14.5px] font-bold">
      {selection.selecting ? (
        <input
          type="checkbox"
          aria-label={`Select ${j.company} · ${j.role}`}
          checked={selection.selected.has(j.id)}
          onChange={() => selection.toggle(j.id)}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 shrink-0 self-center accent-[var(--accent)]"
        />
      ) : null}
      <span className="min-w-0 break-words">{j.company}</span>
      {j.link ? (
        <a href={jobLink(j.link, j.id)} target="_blank" rel="noopener noreferrer" title="Open listing" onClick={(e) => { e.stopPropagation(); markActive(j.id); }} className="ml-auto text-xs text-muted hover:text-accent">↗</a>
      ) : null}
    </div>
  );
}

function cardClass(j: JobRow, selection: Selection, dragId: string | null) {
  const picked = selection.selecting && selection.selected.has(j.id);
  return (
    "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 rounded-lg border bg-surface p-2.5 shadow-sm hover:border-accent " +
    (selection.selecting ? "cursor-pointer " : "cursor-grab ") +
    (picked ? "border-accent ring-2 ring-accent/40 " : "border-line ") +
    (dragId === j.id ? "opacity-45" : "")
  );
}

function JobCard({ j, ctx, selection, drag, onOpen }: CardProps) {
  const activate = () => (selection.selecting ? selection.toggle(j.id) : onOpen(j));
  const startDrag = (e: DragEvent) => {
    drag.setDragId(j.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", j.id);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && activate();
  return (
    <article
      draggable={!selection.selecting}
      tabIndex={0}
      onDragStart={startDrag}
      onDragEnd={() => { drag.setDragId(null); drag.setOverLane(() => null); }}
      onClick={activate}
      onKeyDown={onKey}
      className={cardClass(j, selection, drag.dragId)}
    >
      <CardTitle j={j} selection={selection} />
      <div className="text-[13px] break-words text-muted">{j.role}</div>
      <CardTags j={j} />
      <CardFooter j={j} ctx={ctx} />
    </article>
  );
}

function Lane({ status, list, ...card }: Omit<CardProps, "j"> & { status: string; list: JobRow[] }) {
  const { drag, ctx } = card;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    drag.setOverLane(() => null);
    if (drag.dragId) void moveJob(ctx, drag.dragId, status);
    drag.setDragId(null);
  };
  return (
    <section
      aria-label={status}
      onDragOver={(e) => { if (drag.dragId) { e.preventDefault(); drag.setOverLane(() => status); } }}
      onDragLeave={() => drag.setOverLane((l) => (l === status ? null : l))}
      onDrop={onDrop}
      className={"grid min-h-44 min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-xl border-2 bg-sunk p-2.5 " + (drag.overLane === status ? "border-accent" : "border-transparent")}
    >
      <div className="flex items-center gap-2 px-1 pb-1 font-bold">
        <i className={`h-2 w-2 rounded-full ${DOT[status]}`} />
        {status}
        <span className="ml-auto font-mono text-xs text-muted">{list.length}</span>
      </div>
      {list.length ? (
        list.map((j) => <JobCard key={j.id} j={j} {...card} />)
      ) : (
        <div className="rounded-lg border border-dashed border-line px-2 py-3 text-center text-xs text-muted">Drop a card here</div>
      )}
    </section>
  );
}

/** Every column shares the width, so all of them are always in view; only very narrow windows scroll. */
export function Lanes({ lanes, visible, ...card }: Omit<CardProps, "j" | "drag"> & { lanes: readonly string[]; visible: JobRow[] }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<string | null>(null);
  const drag: Drag = { dragId, setDragId, overLane, setOverLane };
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="grid items-start gap-2" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(170px, 1fr))` }}>
        {lanes.map((status) => (
          <Lane key={status} status={status} list={laneJobs(visible, status)} drag={drag} {...card} />
        ))}
      </div>
    </div>
  );
}
