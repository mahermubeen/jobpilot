"use client";

import { useEffect, useMemo } from "react";
import { useLoad } from "@/lib/client";
import type { BoardCtx } from "./jobs/actions";
import { JobDrawer } from "./jobs/drawer";
import { duplicateOf, useBoardFilters, useJobEditor, useSelection } from "./jobs/hooks";
import { Lanes } from "./jobs/lanes";
import type { JobRow } from "./jobs/model";
import { FilterBar, SelectionBar } from "./jobs/toolbar";
import { useRuns } from "./shell";
import { Button, Notice, PageHeader, useAction, useToast } from "./ui";

function BoardNotice({ loaded, empty }: { loaded: boolean; empty: boolean }) {
  if (!loaded) return <Notice title="Loading jobs…" />;
  return empty ? <Notice title="No jobs yet">Press “Find new jobs” at the top, or add one by hand.</Notice> : null;
}

/** The jobs board: filters, one column per status, and the drawer to edit, draft and apply. */
export function JobsBoard() {
  const { data, error, reload } = useLoad<{ jobs: JobRow[] }>("/api/jobs");
  const { finishedTick } = useRuns();
  const toast = useToast();
  const { busy, run } = useAction();
  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const filters = useBoardFilters(jobs);
  const selection = useSelection();
  const editor = useJobEditor(jobs);
  const ctx: BoardCtx = { jobs, reload, run, toast };

  useEffect(() => {
    if (finishedTick) void reload();
  }, [finishedTick, reload]);

  if (error) return <Notice title="Could not load jobs" tone="bad">{error}</Notice>;
  return (
    <>
      <PageHeader title="Jobs" sub="Drag a card to move it, or click it to edit, draft and apply.">
        <Button variant="primary" onClick={() => editor.open("new")}>+ Add job</Button>
      </PageHeader>
      <FilterBar filters={filters} selection={selection} ctx={ctx} busy={busy} />
      <SelectionBar selection={selection} filters={filters} ctx={ctx} busy={busy} />
      <BoardNotice loaded={!!data} empty={!jobs.length} />
      <Lanes lanes={filters.lanes} visible={filters.visible} ctx={ctx} selection={selection} onOpen={editor.open} />
      <JobDrawer ctx={ctx} editor={editor} busy={busy} duplicate={duplicateOf(jobs, editor)} />
    </>
  );
}
