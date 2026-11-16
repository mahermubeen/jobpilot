import { describe, expect, it } from "vitest";
import { checkSend, type SendFacts } from "@/lib/pipeline/send";

const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
  status: "approved",
  to: "careers@acme.io",
  isFollowUp: false,
  sentToday: 0,
  dailyCap: 20,
  alreadySentToAddress: false,
  contactOptedOut: false,
  emailStatus: "site",
  confirmedGuess: false,
  ...over,
});

describe("checkSend", () => {
  it("allows a normal reviewed email", () => {
    expect(checkSend(facts())).toEqual({ ok: true });
  });

  it("never sends the same email twice", () => {
    expect(checkSend(facts({ status: "sent" })).ok).toBe(false);
    expect(checkSend(facts({ status: "sending" })).ok).toBe(false);
  });

  it("stops at the daily cap", () => {
    expect(checkSend(facts({ sentToday: 20 })).ok).toBe(false);
    expect(checkSend(facts({ sentToday: 19 })).ok).toBe(true);
  });

  it("respects opt-outs even for follow-ups", () => {
    expect(checkSend(facts({ contactOptedOut: true, isFollowUp: true })).ok).toBe(false);
  });

  it("blocks a second first-contact email to the same address but allows a follow-up", () => {
    expect(checkSend(facts({ alreadySentToAddress: true })).ok).toBe(false);
    expect(checkSend(facts({ alreadySentToAddress: true, isFollowUp: true })).ok).toBe(true);
  });

  it("asks for confirmation before sending to a guessed address", () => {
    const first = checkSend(facts({ emailStatus: "guessed" }));
    expect(first).toMatchObject({ ok: false, needsConfirm: true });
    expect(checkSend(facts({ emailStatus: "guessed", confirmedGuess: true })).ok).toBe(true);
  });

  it("rejects an invalid address", () => {
    expect(checkSend(facts({ to: "not-an-email" })).ok).toBe(false);
  });
});
