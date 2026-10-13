import type React from "react";
import { Funnel, Plus, Tag } from "lucide-react";
import { Button } from "../components/Button";
import type { Label } from "../types/model";
import { PageHeader, titleStyle } from "./HeaderActions";

export type LabelsViewProps = {
  labels: Label[];
  filters: { name: string; count: number; color: string }[];
  /** ラベル名 → 件数 (pen の固定値)。省略すると件数は出さない。 */
  counts?: Record<string, number>;
};

function Item({
  icon: Icon,
  color,
  name,
  count,
}: {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  name: string;
  count?: number;
}) {
  return (
    <button
      type="button"
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
      <span style={{ display: "inline-flex", color, flex: "0 0 auto" }}>
        <Icon size={16} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}>{name}</span>
      {count !== undefined && <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>}
    </button>
  );
}

function Group({ title, addLabel, children }: { title: string; addLabel: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 8px 0" }}>
        <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{title}</span>
        <Button variant="icon" icon={Plus} ariaLabel={addLabel} />
      </div>
      {children}
    </section>
  );
}

export function LabelsView({ labels, filters, counts }: LabelsViewProps) {
  return (
    <>
      <PageHeader>
        <h1 style={titleStyle}>フィルターとラベル</h1>
      </PageHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Group title="フィルター" addLabel="フィルターを追加">
          {filters.map((f) => (
            <Item key={f.name} icon={Funnel} color={f.color} name={f.name} count={f.count} />
          ))}
        </Group>
        <Group title="ラベル" addLabel="ラベルを追加">
          {[...labels]
            .sort((a, b) => a.order - b.order)
            .map((l) => (
              <Item key={l.name} icon={Tag} color={l.color} name={l.name} count={counts?.[l.name]} />
            ))}
        </Group>
      </div>
    </>
  );
}
