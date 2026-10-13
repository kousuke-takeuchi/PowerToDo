import { Onboarding } from "../views/Onboarding";
import { ErrorState } from "../views/ErrorState";
import { Main } from "./Main";
import { useAppState } from "./useAppState";

const centered = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  fontFamily: "var(--font-body)",
  color: "var(--color-text-secondary)",
} as const;

export default function App() {
  const { state, retry, pickFolder, confirmDataDir } = useAppState();

  switch (state.status) {
    case "loading":
      return <div style={centered}>読み込み中…</div>;
    case "fatal":
      return (
        <div style={centered}>
          <ErrorState fileName="共通ファイル" detail={state.message} onRetry={() => void retry()} />
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
    case "ready":
      return <Main app={state.app} />;
  }
}
