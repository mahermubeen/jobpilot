import { route } from "@/lib/api";
import { AI_CATALOG, type AiKind } from "@/lib/ai/catalog";
import { unpark } from "@/lib/ai/chain";
import { profileIsReady, type Profile } from "@/lib/cv/types";
import {
  getProfile,
  getSettings,
  saveProfile,
  saveSecrets,
  saveSettings,
  secretsStatus,
  type AppSettings,
  type Secrets,
} from "@/lib/settings";

export const GET = route(async () => {
  const [settings, secrets, profile] = await Promise.all([
    getSettings(),
    secretsStatus(),
    getProfile(),
  ]);
  return { settings, secrets, profile, profileReady: profileIsReady(profile) };
});

export const PUT = route(async (req: Request) => {
  const body = (await req.json()) as {
    settings?: AppSettings;
    secrets?: Partial<Secrets>;
    clearSecrets?: (keyof Secrets)[];
    profile?: Profile;
  };
  if (body.settings) await saveSettings(body.settings);
  if (body.secrets || body.clearSecrets) {
    await saveSecrets(body.secrets ?? {}, body.clearSecrets ?? []);
    // A new key gets a fresh chance in the AI chain.
    const changed = new Set([
      ...Object.entries(body.secrets ?? {}).filter(([, v]) => typeof v === "string" && v.trim()).map(([k]) => k),
      ...(body.clearSecrets ?? []),
    ]);
    await unpark(
      (Object.keys(AI_CATALOG) as AiKind[]).filter((k) => {
        const key = AI_CATALOG[k].keyName;
        return key && changed.has(key);
      }),
    );
  }
  if (body.profile) await saveProfile(body.profile);
  return { ok: true };
});
