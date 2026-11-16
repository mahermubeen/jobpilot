import { route } from "@/lib/api";
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
  }
  if (body.profile) await saveProfile(body.profile);
  return { ok: true };
});
