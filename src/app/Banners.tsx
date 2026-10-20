import { AnimatePresence } from "motion/react";
import { NarrowContext } from "../components/NarrowContext";
import { Collapse } from "../motion";
import type { SyncConflict, SyncRecoverMode } from "../types/model";
import { ConflictBanner } from "../views/ConflictBanner";
import { ExternalChangeBanner } from "../views/ExternalChangeBanner";
import { FixBanner } from "../views/FixBanner";
import { ReminderBanner } from "../views/ReminderBanner";
import type { ReminderBannerProps } from "../views/ReminderBanner";
import { SuspectBanner } from "../views/SuspectBanner";
import { NoticeBanner, SaveBanner } from "./SaveBanner";
import type { useExternalReadFailures } from "./useExternalChanges";

type Flash = { text: string; tone: "error" | "info" };

/** 同期の帯 (Phase 4)。 */
export type SyncBannersProps = {
  /** 片方が空に見えて同期が止まっている (戻す方向を選ばせる)。 */
  suspect?: { side: "local" | "remote"; target: string; busy: boolean; error: string | null; onRecover: (mode: SyncRecoverMode) => void };
  /** 同期のエラー (名前の重なり、容量不足など)。日本語の文言をそのまま出す。 */
  errorMessage?: string | null;
  onDismissError?: () => void;
  conflicts: SyncConflict[];
  /** 「競合ファイルを開く」: データフォルダを開く (ファイルの選択まではしない)。 */
  onOpenConflict: () => void;
  onDismissConflict: (conflictFile: string) => void;
};

/** 競合の帯を並べる上限。超えた分は「ほか N 件」にまとめる。 */
const MAX_CONFLICT_BANNERS = 3;

export type BannersProps = {
  /** リマインダーの帯 (items が空なら出さない)。 */
  reminders: ReminderBannerProps;
  saveErrors: Record<string, string>;
  onRetrySave: (project: string) => void;
  readFailures: ReturnType<typeof useExternalReadFailures>;
  held: string[];
  heldFileName: (project: string) => string;
  onResolve: (project: string, choice: "reload" | "overwrite") => void;
  invalidCount: number;
  onReveal: () => void;
  onReload: () => void;
  notice: string | null | undefined;
  onClearNotice: () => void;
  flash: Flash | null;
  onClearFlash: () => void;
  /** 同期の帯。無ければ出さない。 */
  sync?: SyncBannersProps;
  /** 縦長の幅 (iPhone): 余白を詰め、ボタンを次の行に全幅で並べる。デスクトップは渡さない。 */
  narrow?: boolean;
};

/** 画面上部の帯 (リマインダー / 保存失敗 / 読み込めない変更 / 外部変更の保留 / 型の不整合 / 通知 / 一時メッセージ)。 */
export function Banners({
  reminders,
  saveErrors,
  onRetrySave,
  readFailures,
  held,
  heldFileName,
  onResolve,
  invalidCount,
  onReveal,
  onReload,
  notice,
  onClearNotice,
  flash,
  onClearFlash,
  sync,
  narrow = false,
}: BannersProps) {
  const shownConflicts = sync?.conflicts.slice(0, MAX_CONFLICT_BANNERS) ?? [];
  const hiddenConflicts = sync?.conflicts.slice(MAX_CONFLICT_BANNERS) ?? [];
  // 帯は上から 8px 降りてくる + フェードで出て、消えるときはフェードしながら畳む (150ms)。最初の描画では動かさない。
  return (
    <NarrowContext.Provider value={narrow}>
    <AnimatePresence initial={false}>
      {/* リマインダーは時間に追われるので、他の帯より上。1 件でも複数でも 1 つの帯 (中の行の出入りは ReminderBanner が動かす) */}
      {reminders.items.length > 0 && (
        <Collapse key="rem-banner" duration={0.15} enterY={-8}>
          <ReminderBanner {...reminders} />
        </Collapse>
      )}
      {Object.entries(saveErrors).map(([project, message]) => (
        <Collapse key={`save-${project}`} duration={0.15} enterY={-8}>
          <SaveBanner message={message} onRetry={() => onRetrySave(project)} />
        </Collapse>
      ))}
      {Object.entries(readFailures.failures).map(([project, message]) => (
        <Collapse key={`read-${project}`} duration={0.15} enterY={-8}>
          <NoticeBanner
            message={`「${project === "_common" ? "共通設定" : project}」の Excel の変更を読み込めません: ${message}`}
            onDismiss={() => readFailures.dismiss(project)}
          />
        </Collapse>
      ))}
      {held.map((project) => (
        <Collapse key={`ext-${project}`} duration={0.15} enterY={-8}>
          <ExternalChangeBanner
            fileName={heldFileName(project)}
            onReload={() => onResolve(project, "reload")}
            onOverwrite={() => onResolve(project, "overwrite")}
          />
        </Collapse>
      ))}
      {sync?.suspect && (
        <Collapse key="sync-suspect" duration={0.15} enterY={-8}>
          <SuspectBanner {...sync.suspect} />
        </Collapse>
      )}
      {sync?.errorMessage && !sync.suspect && (
        <Collapse key="sync-error" duration={0.15} enterY={-8}>
          <NoticeBanner message={sync.errorMessage} onDismiss={sync.onDismissError} />
        </Collapse>
      )}
      {shownConflicts.map((c) => (
        <Collapse key={`conflict-${c.conflictFile}`} duration={0.15} enterY={-8}>
          <ConflictBanner
            fileName={c.file}
            conflictName={c.conflictFile}
            onOpen={sync?.onOpenConflict}
            onClose={() => sync?.onDismissConflict(c.conflictFile)}
          />
        </Collapse>
      ))}
      {hiddenConflicts.length > 0 && (
        <Collapse key="conflict-more" duration={0.15} enterY={-8}>
          <NoticeBanner
            tone="info"
            message={`ほか ${hiddenConflicts.length} 件の競合ファイルがあります。データフォルダの「(競合 …)」のファイルを確かめてください`}
            onDismiss={() => hiddenConflicts.forEach((c) => sync?.onDismissConflict(c.conflictFile))}
          />
        </Collapse>
      )}
      {invalidCount > 0 && (
        <Collapse key="fix" duration={0.15} enterY={-8}>
          <FixBanner
            message={`${invalidCount} 行に型の不整合があります。Excel で修正するまで、その行はアプリから編集できません。修正したら「再読み込み」を押してください。`}
            onOpenExcel={onReveal}
            onReload={onReload}
          />
        </Collapse>
      )}
      {notice && (
        <Collapse key="notice" duration={0.15} enterY={-8}>
          <NoticeBanner message={notice} onDismiss={onClearNotice} />
        </Collapse>
      )}
      {flash && (
        <Collapse key="flash" duration={0.15} enterY={-8}>
          <NoticeBanner message={flash.text} tone={flash.tone} onDismiss={onClearFlash} />
        </Collapse>
      )}
    </AnimatePresence>
    </NarrowContext.Provider>
  );
}
