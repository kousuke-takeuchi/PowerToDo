import { AnimatePresence } from "motion/react";
import { Collapse } from "../motion";
import { ExternalChangeBanner } from "../views/ExternalChangeBanner";
import { FixBanner } from "../views/FixBanner";
import { NoticeBanner, SaveBanner } from "./SaveBanner";
import type { useExternalReadFailures } from "./useExternalChanges";

type Flash = { text: string; tone: "error" | "info" };

export type BannersProps = {
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
};

/** 画面上部の帯 (保存失敗 / 読み込めない変更 / 外部変更の保留 / 型の不整合 / 通知 / 一時メッセージ)。 */
export function Banners({
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
}: BannersProps) {
  // 帯は上から 8px 降りてくる + フェードで出て、消えるときはフェードしながら畳む (150ms)。最初の描画では動かさない。
  return (
    <AnimatePresence initial={false}>
      {/* retry_save の失敗は save-status イベントでこの帯に出るので、catch は握りつぶすだけ (二重表示しない) */}
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
  );
}
