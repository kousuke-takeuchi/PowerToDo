import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import type { AppStateDto } from "../types/model";

export type OnboardingState = {
  /** Folder chosen with the dialog; "" until picked. */
  pickedDir: string;
  warning?: string;
  busy: boolean;
  error?: string;
};

export type AppStatus =
  | { status: "loading" }
  | { status: "fatal"; message: string }
  | ({ status: "onboarding" } & OnboardingState)
  /** 初回起動の step 2 (同期先)。データフォルダを決めた直後で、終えたら ready になる。 */
  | { status: "syncStep"; app: AppStateDto }
  | { status: "ready"; app: AppStateDto };

/**
 * Boot state machine: loading -> (fatal | onboarding | ready); onboarding -> syncStep once set_data_dir succeeds; syncStep -> ready.
 * The only Tauri access is through `api`.
 */
export function useAppState() {
  const [state, setState] = useState<AppStatus>({ status: "loading" });
  const alive = useRef(true);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const app = await api.appState();
      if (!alive.current) return;
      if (app.dataDir === null) setState({ status: "onboarding", pickedDir: "", warning: app.warning, busy: false });
      else setState({ status: "ready", app });
    } catch (e) {
      if (alive.current) setState({ status: "fatal", message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const patchOnboarding = useCallback((p: Partial<OnboardingState>) => {
    setState((s) => (s.status === "onboarding" ? { ...s, ...p } : s));
  }, []);

  const pickFolder = useCallback(async () => {
    patchOnboarding({ busy: true, error: undefined });
    try {
      const dir = await api.pickFolder();
      if (!alive.current) return;
      patchOnboarding(dir ? { pickedDir: dir, busy: false } : { busy: false });
    } catch (e) {
      if (alive.current) patchOnboarding({ busy: false, error: errorMessage(e) });
    }
  }, [patchOnboarding]);

  /** 次へ: use the picked folder, or open the dialog first when none was picked. A cancelled dialog stays on step 1. */
  const confirmDataDir = useCallback(
    async (pickedDir: string) => {
      patchOnboarding({ busy: true, error: undefined });
      try {
        let dir = pickedDir;
        if (!dir) {
          const chosen = await api.pickFolder();
          if (!alive.current) return;
          if (!chosen) {
            patchOnboarding({ busy: false });
            return;
          }
          dir = chosen;
          patchOnboarding({ pickedDir: dir });
        }
        const app = await api.setDataDir(dir);
        if (alive.current) setState({ status: "syncStep", app });
      } catch (e) {
        if (alive.current) patchOnboarding({ busy: false, error: errorMessage(e) });
      }
    },
    [patchOnboarding],
  );

  /** Fatal screen: choose another data folder (dialog, then set_data_dir). A cancelled dialog changes nothing. */
  const changeDataDir = useCallback(async () => {
    try {
      const dir = await api.pickFolder();
      if (!dir || !alive.current) return;
      const app = await api.setDataDir(dir);
      if (alive.current) setState({ status: "ready", app });
    } catch (e) {
      if (alive.current) setState({ status: "fatal", message: errorMessage(e) });
    }
  }, []);

  /** 初回起動の同期先 (step 2) を終えて、通常の画面へ。 */
  const finishSyncStep = useCallback(() => {
    setState((s) => (s.status === "syncStep" ? { status: "ready", app: s.app } : s));
  }, []);

  return { state, retry: load, pickFolder, confirmDataDir, changeDataDir, finishSyncStep };
}
