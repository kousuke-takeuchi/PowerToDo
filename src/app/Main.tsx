import type { AppStateDto } from "../types/model";

/** Placeholder until Task 8 wires the real views: lists the project names. */
export function Main({ app }: { app: AppStateDto }) {
  return (
    <div style={{ padding: "var(--space-6)", fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>PowerToDo</h1>
      <ul style={{ margin: "var(--space-3) 0 0", paddingLeft: 20 }}>
        {app.projects.map((p) => (
          <li key={p.name}>{p.name}</li>
        ))}
      </ul>
    </div>
  );
}
