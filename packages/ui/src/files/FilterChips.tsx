// FilterChips.tsx — type filter segment + the folder/file count note.
// Ported from fb-panels.jsx.

import { FbIcon } from "./icons";
import { FILTERS } from "./kinds";

export function FilterChips({
  filter,
  onFilter,
  note,
}: {
  filter: string;
  onFilter: (id: string) => void;
  note: string;
}) {
  return (
    <div className="fb-chips">
      <span className="ic" style={{ color: "var(--muted)", display: "flex", marginRight: -2 }}>
        <FbIcon name="filter" size={14} />
      </span>
      <div className="chip-seg" role="group" aria-label="Filter by type">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? "on" : ""} onClick={() => onFilter(f.id)} aria-pressed={filter === f.id}>
            {f.label}
          </button>
        ))}
      </div>
      <span className="chips-note">{note}</span>
    </div>
  );
}
