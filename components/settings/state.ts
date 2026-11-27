"use client";

import { useCallback, useState } from "react";
import { api, useLoad } from "@/lib/client";
import type { Profile } from "@/lib/cv/types";
import type { AppSettings, Secrets } from "@/lib/settings";

/** Which secrets are saved (never their values), plus the Gmail address. */
export type SecretStatus = {
  anthropicKey: boolean; aiKey: boolean; openaiKey: boolean; geminiKey: boolean; xaiKey: boolean; groqKey: boolean; apifyToken: boolean; gmailUser: string; gmailAppPassword: boolean; apolloKey: boolean;
  adzunaAppId: boolean; adzunaKey: boolean; reedKey: boolean; joobleKey: boolean;
};
type Loaded = { settings: AppSettings; secrets: SecretStatus; profile: Profile; profileReady: boolean };

/** Loads settings once and keeps editable copies; `save` writes one part back. */
export function useSettings() {
  const { data, error, reload } = useLoad<Loaded>("/api/settings");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Copy the saved values into editable state once, when they first arrive.
  if (data && !seeded) {
    setSeeded(true);
    setSettings(data.settings);
    setProfile(data.profile);
  }

  const save = useCallback(
    async (part: { settings?: AppSettings; profile?: Profile; secrets?: Partial<Secrets> }) => {
      await api("/api/settings", { method: "PUT", body: part });
      await reload();
    },
    [reload],
  );

  return { data, error, settings, setSettings, profile, setProfile, save };
}

export type SettingsState = ReturnType<typeof useSettings>;
