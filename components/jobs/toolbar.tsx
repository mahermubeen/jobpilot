"use client";

import { OLDER_THAN, type OlderThanHours } from "@/lib/pipeline/cleanup";
import { Button, Check, Input, Select } from "../ui";
import { type BoardCtx, deleteOlder, deleteOutsideFilters, deleteSelected } from "./actions";
import type { BoardFilters, Selection } from "./hooks";

function CleanUp({ ctx, busy }: { ctx: BoardCtx; busy: string | null }) {
  return (
    <Select
      value=""
      onChange={(e) => (e.target.value === "filters" ? deleteOutsideFilters(ctx) : deleteOlder(ctx, Number(e.target.value) as OlderThanHours))}
      className="w-auto"
      aria-label="Clean up jobs"
      disabled={busy === "older" || !ctx.jobs.length}
    >
      <option value="">Clean up…</option>
      {OLDER_THAN.map((o) => (
        <option key={o.hours} value={o.hours}>
          Delete {o.label.toLowerCase()}
        </option>
      ))}
      <option value="filters">Delete jobs not matching my filters</option>
    </Select>
  );
}

export function FilterBar({ filters: f, selection, ctx, busy }: { filters: BoardFilters; selection: Selection; ctx: BoardCtx; busy: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="search" placeholder="Search company, role, notes…" value={f.q} onChange={(e) => f.setQ(e.target.value)} className="max-w-xs flex-1" aria-label="Search jobs" />
      <Select value={f.fit} onChange={(e) => f.setFit(e.target.value)} className="w-auto" aria-label="Fit">
        <option value="">Any fit</option>
        <option>Strong</option>
        <option>Partial</option>
        <option>Skip</option>
      </Select>
      <Select value={f.source} onChange={(e) => f.setSource(e.target.value)} className="w-auto" aria-label="Source">
        <option value="">Any source</option>
        {f.sources.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </Select>
      <Check label="Show Rejected & Skipped" checked={f.showClosed} onChange={(e) => f.setShowClosed(e.target.checked)} />
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <CleanUp ctx={ctx} busy={busy} />
        <Button onClick={() => (selection.selecting ? selection.stop() : selection.start())} disabled={!ctx.jobs.length}>
          {selection.selecting ? "Done selecting" : "Select"}
        </Button>
      </span>
    </div>
  );
}

export function SelectionBar({ selection: sel, filters, ctx, busy }: { selection: Selection; filters: BoardFilters; ctx: BoardCtx; busy: string | null }) {
  if (!sel.selecting) return null;
  const lanes = filters.lanes as readonly string[];
  const selectAllShown = () => sel.setSelected(new Set(filters.visible.filter((j) => lanes.includes(j.status)).map((j) => j.id)));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
      <b>{sel.selected.size} selected</b>
      <span className="text-muted">Click cards to select them.</span>
      <span className="ml-auto flex flex-wrap gap-2">
        <Button small onClick={selectAllShown}>
          Select all shown
        </Button>
        <Button small onClick={() => sel.setSelected(new Set())} disabled={!sel.selected.size}>
          Clear
        </Button>
        <Button small variant="danger" onClick={() => deleteSelected(ctx, sel.selected, sel.stop)} busy={busy === "bulk"} disabled={!sel.selected.size}>
          Delete selected
        </Button>
      </span>
    </div>
  );
}
