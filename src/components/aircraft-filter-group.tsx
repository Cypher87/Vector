import type { ReactNode } from 'react';
import { VectorIcon } from './vector-icon';

/** Native, keyboard-accessible accordion. Keep fields mounted to preserve unfinished edits. */
export function AircraftFilterGroup({ id, name, title, summary, active = false, children }: {
  id: string; name: string; title: string; summary: string; active?: boolean; children: ReactNode;
}) {
  return (
    <details className={`filter-group ${active ? 'has-filters' : ''}`} data-filter-group={id} name={name}>
      <summary aria-label={title}>
        <span className="filter-group-copy">
          <strong>{title}</strong>
          <small title={summary}>{summary}</small>
        </span>
        <VectorIcon name="chevronDown" />
      </summary>
      <div className="filter-group-content">{children}</div>
    </details>
  );
}
