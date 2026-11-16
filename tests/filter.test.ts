import { describe, expect, it } from "vitest";
import { minPayUsdMonth, parsePay } from "@/lib/pay";
import { rejectReason, type JobFilter } from "@/lib/pipeline/filter";

const yearly = (text: string) => {
  const p = parsePay(text);
  if (p.kind !== "salary") throw new Error(`${text} parsed as ${p.kind}`);
  return [Math.round(p.minUsdMonth * 12), Math.round(p.maxUsdMonth * 12)];
};

describe("parsePay", () => {
  it("reads dollar ranges as yearly", () => {
    expect(yearly("$72k–$108k")).toEqual([72000, 108000]);
    expect(yearly("$3-5k per year")).toEqual([3000, 5000]);
  });

  it("uses the currency code over the symbol", () => {
    expect(yearly("$80k–$150k CAD")).toEqual([58400, 109500]);
  });

  it("reads lakhs", () => {
    expect(yearly("₹9L–₹11L")).toEqual([10588, 12941]);
    expect(yearly("₹12–14 LPA")).toEqual([14118, 16471]);
    expect(yearly("₹10k–₹1.5L")).toEqual([118, 1765]);
  });

  it("reads monthly and hourly pay", () => {
    expect(yearly("$2,000/mo")).toEqual([24000, 24000]);
    expect(yearly("$2/hr")).toEqual([3840, 3840]);
    expect(yearly("PKR 150k–400k/mo")).toEqual([6429, 17143]);
  });

  it("treats rupees without a period as monthly", () => {
    expect(yearly("PKR 200,000")).toEqual([8571, 8571]);
  });

  it("recognises equity and unpaid", () => {
    expect(parsePay("0.5%–1% equity").kind).toBe("equity");
    expect(parsePay("Unpaid internship").kind).toBe("unpaid");
  });

  it("leaves vague text unknown", () => {
    for (const t of ["", "Market-aligned", "USD", "Salary + share options", "$3–5k freelance", "150k"]) {
      expect(parsePay(t).kind).toBe("unknown");
    }
  });
});

const filter: JobFilter = {
  minPay: { amount: 150000, currency: "PKR", period: "month" },
  dropUnpaid: true,
  homeCity: "Islamabad",
};
const job = (over: Partial<Parameters<typeof rejectReason>[0]>) => ({
  role: "Full Stack Engineer",
  pay: "",
  mode: "",
  location: "Remote",
  ...over,
});

describe("rejectReason", () => {
  it("converts the minimum", () => {
    expect(Math.round(minPayUsdMonth(filter.minPay))).toBe(536);
    expect(minPayUsdMonth({ amount: 0, currency: "USD", period: "year" })).toBe(0);
  });

  it("drops pay that tops out below the minimum", () => {
    expect(rejectReason(job({ pay: "$2/hr" }), filter)).toMatch(/below minimum/);
    expect(rejectReason(job({ pay: "₹1.8L–₹2.4L" }), filter)).toMatch(/below minimum/);
  });

  it("keeps pay that reaches the minimum, and unstated pay", () => {
    expect(rejectReason(job({ pay: "$12k–$16k" }), filter)).toBeNull();
    expect(rejectReason(job({ pay: "PKR 100k–200k/mo" }), filter)).toBeNull();
    expect(rejectReason(job({ pay: "" }), filter)).toBeNull();
    expect(rejectReason(job({ pay: "Market-aligned" }), filter)).toBeNull();
  });

  it("drops equity-only and volunteer roles", () => {
    expect(rejectReason(job({ pay: "1% equity" }), filter)).toBe("Equity only");
    expect(rejectReason(job({ role: "Frontend Engineer (Volunteer)" }), filter)).toBe("Unpaid or volunteer");
    expect(rejectReason(job({ pay: "1% equity" }), { ...filter, dropUnpaid: false })).toBeNull();
  });

  it("keeps onsite and hybrid jobs in the home city", () => {
    expect(rejectReason(job({ location: "Islamabad (hybrid)", mode: "Hybrid" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Islamabad, Pakistan", mode: "Onsite" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Islāmābād, Pakistan" }), filter)).toBeNull();
  });

  it("drops onsite jobs elsewhere", () => {
    expect(rejectReason(job({ location: "Lahore" }), filter)).toMatch(/not in Islamabad/);
    expect(rejectReason(job({ location: "Karāchi, Sindh, Pakistan" }), filter)).toMatch(/not in Islamabad/);
    expect(rejectReason(job({ location: "US only" }), filter)).toMatch(/not in Islamabad/);
  });

  it("keeps remote jobs from anywhere", () => {
    expect(rejectReason(job({ location: "Lahore", mode: "Remote" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Remote – Pakistan" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Anywhere" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Karachi", description: "This is a fully remote role." }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Karachi", description: "Onsite, not remote." }), filter)).toMatch(/not in Islamabad/);
  });

  it("keeps listings located only in a country", () => {
    expect(rejectReason(job({ location: "Pakistan" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "United States" }), filter)).toBeNull();
    expect(rejectReason(job({ role: "Desenvolvedor React - Trabalho Remoto", location: "Campinas, Brazil" }), filter)).toBeNull();
  });

  it("keeps jobs with no location, and every location when no home city is set", () => {
    expect(rejectReason(job({ location: "" }), filter)).toBeNull();
    expect(rejectReason(job({ location: "Lahore" }), { ...filter, homeCity: "" })).toBeNull();
  });
});
