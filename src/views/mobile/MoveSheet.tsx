import { Check, Folder, Inbox } from "lucide-react";
import type { ProjectSummary, Section } from "../../types/model";
import { SheetCard, SheetRow } from "./BottomSheet";

export type MoveSheetProps = {
  projects: ProjectSummary[];
  /** 今のプロジェクトのセクション (別のプロジェクトのタスクのときは空)。 */
  sections: Section[];
  current: { project: string; section: string | null };
  /** 移し先。section は null で「セクションなし」。 */
  onMove: (project: string, section: string | null) => void;
  onClose: () => void;
};

const head = { padding: "8px 4px 4px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" } as const;

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
      <SheetCard label="プロジェクト">
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
      </SheetCard>
      {own.length > 0 && (
        <>
          <div style={head}>{`セクション (${current.project})`}</div>
          <SheetCard label="セクション">
            <SheetRow label="セクションなし" selected={current.section === null} onClick={() => go(current.project, null)} />
            {own.map((s) => (
              <SheetRow key={s.name} label={s.name} selected={current.section === s.name} onClick={() => go(current.project, s.name)} />
            ))}
          </SheetCard>
        </>
      )}
    </div>
  );
}
