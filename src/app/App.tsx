import { Onboarding } from "../views/Onboarding";
import { ErrorState } from "../views/ErrorState";
import { Main } from "./Main";
import { MobileMain } from "./MobileMain";
import { usePlatform } from "./platform";
import { OnboardingSync } from "./OnboardingSync";
import { useAppState } from "./useAppState";
import { useSyncConflicts } from "./useSyncConflicts";

const centered = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  fontFamily: "var(--font-body)",
  color: "var(--color-text-secondary)",
} as const;

export default function App() {
  const { mobile } = usePlatform();
  const { state, retry, pickFolder, confirmDataDir, changeDataDir, finishSyncStep } = useAppState();
  // 初回起動の step 2 で起きた競合も、メイン画面の帯に出す
  const syncConflicts = useSyncConflicts();

  switch (state.status) {
    case "loading":
      return <div style={centered}>読み込み中…</div>;
    case "fatal":
      return (
        <div style={centered}>
          <ErrorState fileName="共通ファイル" detail={state.message} onRetry={() => void retry()} onChangeFolder={() => void changeDataDir()} />
        </div>
      );
    case "onboarding":
      return (
        <Onboarding
          step={1}
          fill
          dataDir={state.pickedDir}
          warning={state.warning}
          busy={state.busy}
          error={state.error}
          onPickFolder={() => void pickFolder()}
          onNext={() => void confirmDataDir(state.pickedDir)}
        />
      );
    case "syncStep":
      return <OnboardingSync onDone={finishSyncStep} />;
    case "ready":
      return mobile ? <MobileMain app={state.app} syncConflicts={syncConflicts} /> : <Main app={state.app} syncConflicts={syncConflicts} />;
  }
}
