import React from 'react';

/* Section header: left = mono orange section ID + Archivo Black H2; right = short mono note. */
export function SectionHeader({ id, title, note, className = '' }) {
  return (
    <div className={`sechead ${className}`.trim()}>
      <div>
        {id && <p className="sechead-id">{id}</p>}
        <h2 className="t-h2">{title}</h2>
      </div>
      {note && <p className="sechead-note">{note}</p>}
    </div>
  );
}
