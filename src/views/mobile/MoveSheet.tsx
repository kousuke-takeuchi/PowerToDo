import { Check, Folder, Inbox } from "lucide-react";
import type { ProjectSummary, Section } from "../../types/model";
import { SheetRow } from "./BottomSheet";

export type MoveSheetProps = {
  projects: ProjectSummary[];
  /** 今のプロジェクトのセクション (別のプロジェクトのタスクのときは空)。 */
  sections: Section[];
  current: { project: string; section: string | null };
  /** 移し先。section は null で「セクションなし」。 */
  onMove: (project: string, section: string | null) => void;
  onClose: () => void;
};

const head = { padding: "8px 8px 0", fontSize: 12, lineHeight: "17px", fontWeight: 600, color: "var(--color-text-muted)" } as const;

/** 移動のシートの中身 (BottomSheet の children)。別のプロジェクトを選ぶとその「セクションなし」へ、今のプロジェクトのセクションを選ぶとそこへ。 */
export function MoveSheet({ projects, sections, current, onMove, onClose }: MoveSheetProps) {
  const go = (project: string, section: string | null) => {
    if (project !== current.project || section !== current.section) onMove(project, section);
    onClose();
  };
  const own = [...sections].sort((a, b) => a.order - b.order);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={head}>プロジェクト</div>
      <div role="group" aria-label="プロジェクト">
        {projects
          .filter((p) => !p.loadError)
          .map((p) => (
            <SheetRow
              key={p.name}
              icon={p.name === current.project ? <Check size={18} /> : p.inbox ? <Inbox size={18} /> : <Folder size={18} />}
              iconColor={p.color}
              label={p.inbox ? "受信トレイ" : p.name}
              selected={p.name === current.project}
              onClick={() => go(p.name, null)}
            />
          ))}
      </div>
      {own.length > 0 && (
        <>
          <div style={head}>{`セクション (${current.project})`}</div>
          <div role="group" aria-label="セクション">
            <SheetRow label="セクションなし" selected={current.section === null} onClick={() => go(current.project, null)} />
            {own.map((s) => (
              <SheetRow key={s.name} label={s.name} selected={current.section === s.name} onClick={() => go(current.project, s.name)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
