import { ImapFlow } from "imapflow";
import { getSecrets } from "@/lib/settings";

/**
 * Returns the addresses (lower-cased) that have written to the inbox since
 * the given time. Used to mark sent applications as replied.
 */
export async function findReplies(
  sent: { email: string; since: Date }[],
): Promise<Set<string>> {
  const replied = new Set<string>();
  if (!sent.length) return replied;

  const { gmailUser, gmailAppPassword } = await getSecrets();
  if (!gmailUser || !gmailAppPassword) return replied;

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
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const { email, since } of sent) {
        const hits = await client.search({ from: email, since });
        if (hits && hits.length) replied.add(email.toLowerCase());
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return replied;
}
