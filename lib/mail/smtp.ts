import nodemailer from "nodemailer";
import { getSecrets } from "@/lib/settings";

export type OutgoingMail = {
  fromName: string;
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Buffer };
  /** Message-ID of the email this one replies to, for threading. */
  inReplyTo?: string;
};

async function transport() {
  const { gmailUser, gmailAppPassword } = await getSecrets();
  if (!gmailUser || !gmailAppPassword) {
    throw new Error("Gmail is not connected. Add your address and app password in Settings.");
  }
  return {
    user: gmailUser,
    transporter: nodemailer.createTransport({
      // Gmail by default; set JOBPILOT_SMTP_* to use another mail provider.
      host: process.env.JOBPILOT_SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.JOBPILOT_SMTP_PORT || 465),
      secure: (process.env.JOBPILOT_SMTP_SECURE ?? "true") !== "false",
      auth: { user: gmailUser, pass: gmailAppPassword.replace(/\s+/g, "") },
      connectionTimeout: 20_000,
      socketTimeout: 60_000,
    }),
  };
}

export async function sendMail(mail: OutgoingMail): Promise<{ messageId: string }> {
  const { user, transporter } = await transport();
  const info = await transporter.sendMail({
    from: { name: mail.fromName, address: user },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachment
      ? [
          {
            filename: mail.attachment.filename,
            content: mail.attachment.content,
            contentType: "application/pdf",
          },
        ]
      : [],
    ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: [mail.inReplyTo] } : {}),
  });
  if (info.rejected?.length) {
    throw new Error(`The mail server rejected ${info.rejected.join(", ")}.`);
  }
  return { messageId: info.messageId };
}

export async function testSmtp(): Promise<string> {
  const { user, transporter } = await transport();
  await transporter.verify();
  return `Gmail accepted the sign-in for ${user}.`;
}
