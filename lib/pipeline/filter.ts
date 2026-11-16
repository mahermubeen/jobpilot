import { minPayUsdMonth, parsePay, type MinPay } from "@/lib/pay";

export type JobFilter = {
  minPay: MinPay;
  dropUnpaid: boolean;
  homeCity: string;
};

export type FilterableJob = {
  role: string;
  pay?: string | null;
  mode?: string | null;
  location?: string | null;
  description?: string | null;
};

const REMOTE = /\b(remote|remoto|remota|teletrabajo|teletravail|anywhere|worldwide|work from home|wfh)\b/;
const NOT_REMOTE = /\b(not|no|non)[ -]remote\b/;

/** Lower-cases and strips accents, so LinkedIn's "Islāmābād" matches "Islamabad". */
const plain = (text: string | null | undefined) =>
  (text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const saysRemote = (text: string | null | undefined) => {
  const t = plain(text);
  return REMOTE.test(t) && !NOT_REMOTE.test(t);
};

// A listing located only in a country ("Pakistan", "United States") names no
// city, which is how job boards often show remote roles.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = new Set<string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = regionNames.of(code);
    if (name && name !== code) COUNTRIES.add(plain(name));
  }
}

/**
 * Why a job falls outside the user's pay and place rules, or null when it is
 * fine. Listings that state no pay, no location or only a country pass: only
 * a stated fact can rule a job out.
 */
export function rejectReason(job: FilterableJob, filter: JobFilter): string | null {
  const pay = parsePay(job.pay);

  if (filter.dropUnpaid) {
    if (/\b(volunteer|unpaid)\b/i.test(job.role) || pay.kind === "unpaid") return "Unpaid or volunteer";
    if (pay.kind === "equity") return "Equity only";
  }

  const min = minPayUsdMonth(filter.minPay);
  if (min > 0 && pay.kind === "salary" && pay.maxUsdMonth < min) {
    return `Pay below minimum (${job.pay})`;
  }

  const home = plain(filter.homeCity);
  const location = plain(job.location);
  if (home && location && !location.includes(home) && !COUNTRIES.has(location)) {
    const remote =
      saysRemote(job.mode) || saysRemote(location) || saysRemote(job.role) || saysRemote(job.description);
    if (!remote) return `Not remote and not in ${filter.homeCity.trim()} (${job.location})`;
  }
  return null;
}
