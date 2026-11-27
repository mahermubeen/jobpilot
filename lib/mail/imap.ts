import { ImapFlow } from "imapflow";
import { getSecrets } from "@/lib/settings";

/**
 * Returns the addresses (lower-cased) that have written to the inbox since
 * the given time. Used to mark sent applications as replied.
 */
export async function findReplies(
  sent: { email: string; since: Date }[],
): Promise<Set<string>> {
  if (!sent.length) return new Set();
  const { gmailUser, gmailAppPassword } = await getSecrets();
  if (!gmailUser || !gmailAppPassword) return new Set();

  const client = new ImapFlow({
    host: process.env.JOBPILOT_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.JOBPILOT_IMAP_PORT || 993),
    secure: true,
    auth: { user: gmailUser, pass: gmailAppPassword.replace(/\s+/g, "") },
    logger: false,
  });
  // Without a listener a dropped connection would crash the process.
  client.on("error", () => {});

  await client.connect();
  try {
    return await searchInbox(client, sent);
  } finally {
    await client.logout().catch(() => {});
  }
}

/** One search per sent address, inside one inbox lock. */
async function searchInbox(client: ImapFlow, sent: { email: string; since: Date }[]): Promise<Set<string>> {
  const replied = new Set<string>();
  const lock = await client.getMailboxLock("INBOX");
  try {
    for (const { email, since } of sent) {
      // One IMAP connection runs one command at a time, so the searches go one after another.
      // eslint-disable-next-line no-await-in-loop -- a single IMAP connection, commands are serial
      const hits = await client.search({ from: email, since });
      if (hits && hits.length) replied.add(email.toLowerCase());
    }
  } finally {
    lock.release();
  }
  return replied;
}
