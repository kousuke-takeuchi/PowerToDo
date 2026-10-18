import { Onboarding } from "../views/Onboarding";
import { useSync } from "./useSync";

/**
 * 初回起動の step 2 (同期先)。データフォルダを決めたあとに出す。選んだ同期先は、設定の「同期」ペインと同じ部品で接続まで進める。
 * 切り替えは確認なし (まだ何も同期していない)。「スキップ」は同期しないにして先へ。
 */
export function OnboardingSync({ onDone }: { onDone: () => void }) {
  const sync = useSync({ active: true });

  const skip = async () => {
    // NAS を選びかけていたら、同期しないに戻してから進む。戻せなかったら (理由はペインに出る) 進まない。
    if (sync.settings && sync.settings.backend !== "none" && !(await sync.setBackend("none", { confirm: false }))) return;
    onDone();
  };

  return (
    <Onboarding
      step={2}
      fill
      syncPane={{ ...sync.pane, onChangeBackend: (b) => void sync.setBackend(b, { confirm: false }) }}
      onSyncDone={onDone}
      onSkip={() => void skip()}
    />
  );
}
