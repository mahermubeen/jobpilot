"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { JOB_STATUSES } from "@/lib/fields";
import type { Editing } from "./actions";
import { blank, CLOSED, filterJobs, type Form, type JobRow, norm, toForm } from "./model";

export function useBoardFilters(jobs: JobRow[]) {
  const [q, setQ] = useState("");
  const [fit, setFit] = useState("");
  const [source, setSource] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const sources = useMemo(() => [...new Set(jobs.map((j) => j.source).filter(Boolean))].sort() as string[], [jobs]);
  const visible = useMemo(() => filterJobs(jobs, { q, fit, source }), [jobs, q, fit, source]);
  const lanes = JOB_STATUSES.filter((s) => showClosed || !CLOSED.includes(s));
  return { q, setQ, fit, setFit, source, setSource, showClosed, setShowClosed, sources, visible, lanes };
}
export type BoardFilters = ReturnType<typeof useBoardFilters>;

export function useSelection() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stop = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  return { selecting, start: () => setSelecting(true), stop, selected, setSelected, toggle };
}
export type Selection = ReturnType<typeof useSelection>;

/**
 * Deep link from the Today and Leads pages: /jobs?open=<id> opens that job once
 * the jobs have loaded. State is adjusted during render, so there is no flash.
 */
function useDeepLink(jobs: JobRow[], openJob: (j: JobRow) => void) {
  const params = useSearchParams();
  const wanted = params.get("open");
  const [handledOpen, setHandledOpen] = useState<string | null>(null);
  if (!wanted && handledOpen) setHandledOpen(null);
  if (wanted && wanted !== handledOpen && jobs.length) {
    setHandledOpen(wanted);
    const j = jobs.find((x) => x.id === wanted);
    if (j) openJob(j);
  }
}

/** The drawer: which job is open, its form, and the "did you apply?" prompt. */
export function useJobEditor(jobs: JobRow[]) {
  const params = useSearchParams();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [form, setForm] = useState<Form>(blank);
  const [askApplied, setAskApplied] = useState(false);
  const open = (j: JobRow | "new") => {
    setEditing(j);
    setForm(j === "new" ? blank() : toForm(j));
    setAskApplied(false);
  };
  const close = () => {
    setEditing(null);
    if (params.get("open")) router.replace("/jobs");
  };
  useDeepLink(jobs, (j) => {
    setEditing(j);
    setForm(toForm(j));
  });
  const current = editing && editing !== "new" ? (jobs.find((j) => j.id === editing.id) ?? editing) : null;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return { editing, form, setForm, set, open, close, done: () => setEditing(null), current, askApplied, setAskApplied };
}
export type JobEditor = ReturnType<typeof useJobEditor>;

/** A job with the same company and role already on the board, while adding one by hand. */
export function duplicateOf(jobs: JobRow[], editor: JobEditor): JobRow | null {
  const { editing, form } = editor;
  if (editing !== "new" || !form.company || !form.role) return null;
  return jobs.find((j) => norm(j.company) === norm(form.company) && norm(j.role) === norm(form.role)) ?? null;
}
