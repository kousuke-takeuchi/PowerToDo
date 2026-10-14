import type React from "react";
import { useState } from "react";
import { Funnel, Plus, Tag } from "lucide-react";
import { Button } from "../components/Button";
import type { Label } from "../types/model";
import { PageHeader, titleStyle } from "./HeaderActions";
import { InlineEdit } from "./InlineEdit";
import { LabelMenu } from "./LabelMenu";

export type LabelsViewProps = {
  labels: Label[];
  filters: { name: string; count: number; color: string }[];
  /** ラベル名 → 件数 (pen の固定値)。省略すると件数は出さない。 */
  counts?: Record<string, number>;
  /** ラベル行をクリックしたとき (ラベル詳細へ)。 */
  onOpenLabel?: (name: string) => void;
  /** 渡すと「ラベル」の「+」が名前入力欄を開き、Enter でこれを呼ぶ (Esc で閉じる)。 */
  onAddLabel?: (name: string) => void;
  onRenameLabel?: (name: string, newName: string) => void;
  onChangeColor?: (name: string, color: string) => void;
  onDeleteLabel?: (name: string) => void;
  /** 「フィルター」の「+」を押したとき。 */
  onAddFilter?: () => void;
  /** ラベルの色の選択肢 (CSS 変数)。メニューの色の丸に使う。 */
  palette?: string[];
};

const rowBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "10px 8px",
  borderRadius: 6,
  fontFamily: "var(--font-body)",
};

function Item({
  icon: Icon,
  color,
  name,
  count,
  onClick,
  trailing,
  editing,
}: {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  name: string;
  count?: number;
  onClick?: () => void;
  /** 行の右端 (ラベルのメニュー)。あると行は group になり、ホバーで見える。 */
  trailing?: React.ReactNode;
  /** あると名前の代わりにこれ (InlineEdit) を出す。 */
  editing?: React.ReactNode;
}) {
  const icon = (
    <span style={{ display: "inline-flex", color, flex: "0 0 auto" }}>
      <Icon size={16} />
    </span>
  );
  if (editing) {
    return (
      <div style={{ ...rowBox, padding: "6px 8px" }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>{editing}</div>
      </div>
    );
  }
  const countEl = count !== undefined && <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>;
  const nameEl = <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}>{name}</span>;
  if (trailing) {
    return (
      <div className="group hover:bg-[var(--color-bg-hover)]" style={{ ...rowBox, padding: "0 4px 0 0" }}>
        <button
          type="button"
          onClick={onClick}
          className="bg-transparent"
          style={{ ...rowBox, flex: 1, minWidth: 0, border: 0, textAlign: "left", cursor: "pointer" }}
        >
          {icon}
          {nameEl}
          {countEl}
        </button>
        {trailing}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "10px 8px",
        border: 0,
        borderRadius: 6,
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {icon}
      {nameEl}
      {countEl}
    </button>
  );
}

function Group({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 8px 0" }}>
        <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{title}</span>
        <Button variant="icon" icon={Plus} ariaLabel={addLabel} onClick={onAdd} />
      </div>
      {children}
    </section>
  );
}

export function LabelsView({
  labels,
  filters,
  counts,
  onOpenLabel,
  onAddLabel,
  onRenameLabel,
  onChangeColor,
  onDeleteLabel,
  onAddFilter,
  palette,
}: LabelsViewProps) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const manage = palette && onRenameLabel && onChangeColor && onDeleteLabel;
  return (
    <>
      <PageHeader>
        <h1 style={titleStyle}>フィルターとラベル</h1>
      </PageHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Group title="フィルター" addLabel="フィルターを追加" onAdd={onAddFilter}>
          {filters.map((f) => (
            <Item key={f.name} icon={Funnel} color={f.color} name={f.name} count={f.count} />
          ))}
        </Group>
        <Group title="ラベル" addLabel="ラベルを追加" onAdd={onAddLabel ? () => setAdding(true) : undefined}>
          {adding && onAddLabel && (
            <Item
              icon={Tag}
              color="var(--color-text-muted)"
              name=""
              editing={
                <InlineEdit
                  placeholder="ラベル名"
                  ariaLabel="新しいラベルの名前"
                  onCommit={(v) => {
                    setAdding(false);
                    onAddLabel(v);
                  }}
                  onCancel={() => setAdding(false)}
                />
              }
            />
          )}
          {[...labels]
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <Item
                key={l.name}
                icon={Tag}
                color={l.color}
                name={l.name}
                count={counts?.[l.name]}
                onClick={onOpenLabel ? () => onOpenLabel(l.name) : undefined}
                editing={
                  manage && renaming === l.name ? (
                    <InlineEdit
                      value={l.name}
                      ariaLabel={`ラベル「${l.name}」の名前`}
                      onCommit={(v) => {
                        setRenaming(null);
                        if (v !== l.name) onRenameLabel(l.name, v);
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : undefined
                }
                trailing={
                  manage ? (
                    <LabelMenu
                      name={l.name}
                      palette={palette}
                      color={l.color}
                      onRename={() => setRenaming(l.name)}
                      onColor={(c) => onChangeColor(l.name, c)}
                      onDelete={() => onDeleteLabel(l.name)}
                    />
                  ) : undefined
                }
              />
            ))}
        </Group>
      </div>
    </>
  );
}
