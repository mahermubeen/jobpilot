"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---------- buttons ----------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  small?: boolean;
  busy?: boolean;
};

export function Button({ variant = "default", small, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "border-accent bg-accent text-accent-ink hover:opacity-90",
        variant === "default" && "border-line bg-surface hover:border-accent",
        variant === "danger" && "border-line bg-surface text-bad hover:border-bad",
        variant === "ghost" && "border-transparent text-muted hover:text-fg",
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href, children, small, primary, ...rest
}: { href: string; children: ReactNode; small?: boolean; primary?: boolean } & Record<string, unknown>) {
  return (
    <a
      href={href}
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold whitespace-nowrap no-underline",
        small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        primary ? "border-accent bg-accent text-accent-ink hover:opacity-90" : "border-line bg-surface hover:border-accent",
      )}
    >
      {children}
    </a>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

// ---------- form fields ----------

const baseField =
  "rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-fg placeholder:text-muted/70";
/** Fields fill their container unless the caller sets a width. */
const fieldClass = (className?: string) =>
  cx(baseField, /(^|\s)(w-|max-w-|flex-1)/.test(className ?? "") ? "min-w-0" : "w-full", className);

export function Label({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted">
      <span>{label}</span>
      {children}
      {hint ? <span className="font-normal">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={fieldClass(props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldClass(props.className), "min-h-24 resize-y")} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={fieldClass(props.className)} />;
}

export function Check({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
      <input type="checkbox" {...rest} className="h-4 w-4 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

// ---------- display ----------

const tones = {
  plain: "bg-sunk text-muted",
  accent: "bg-accent-soft text-accent",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
} as const;

export function Tag({ tone = "plain", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cx("inline-block max-w-full rounded-xl px-2 py-0.5 align-middle text-[11px] font-bold break-words", tones[tone])}>
      {children}
    </span>
  );
}

export const fitTone = (fit: string | null | undefined) =>
  fit === "Strong" ? "good" : fit === "Partial" ? "warn" : fit === "Skip" ? "bad" : "plain";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl border border-line bg-surface p-4", className)}>{children}</section>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <b className="block text-2xl leading-tight font-bold tabular-nums">{value}</b>
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</span>
    </div>
  );
}

export function Notice({ title, children, tone }: { title: string; children?: ReactNode; tone?: "bad" }) {
  return (
    <div className={cx("rounded-xl border border-dashed p-6 text-center text-muted", tone === "bad" ? "border-bad" : "border-line")}>
      <b className="mb-1 block text-base text-fg">{title}</b>
      {children}
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-balance">{title}</h1>
        {sub ? <p className="mt-0.5 text-muted">{sub}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

// ---------- drawer ----------

export function Drawer({
  title, open, onClose, children, footer, wide,
}: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/45" onClick={onClose} />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        className={cx(
          "fixed top-0 right-0 bottom-0 z-30 flex w-full flex-col border-l border-line bg-surface outline-none",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="min-w-0 truncate text-lg font-bold">{title}</h2>
          <Button onClick={onClose} aria-label="Close" small>✕</Button>
        </div>
        <div className="grid flex-1 content-start gap-3 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </aside>
    </>
  );
}

// ---------- toast ----------

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-40 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg bg-fg px-4 py-2.5 text-sm font-semibold text-bg shadow-lg"
        >
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Runs an async action with a busy flag and a toast on failure. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, fn: () => Promise<string | void>) => {
      setBusy(key);
      try {
        const message = await fn();
        if (message) toast(message);
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
