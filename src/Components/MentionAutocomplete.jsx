import React from "react";

function MentionAutocomplete({ open, loading, items, onSelect, emptyLabel = "No users found." }) {
  if (!open) return null;
  const rows = Array.isArray(items) ? items : [];
  const hasRows = rows.length > 0;

  return (
    <div className="mention-autocomplete" role="listbox" aria-label="Mention suggestions">
      {loading ? (
        <div className="mention-autocomplete-row muted">Searching users...</div>
      ) : hasRows ? (
        rows.map((m) => {
          const handle = String(m?.handle || "").trim().toLowerCase();
          const name = String(m?.username || "").trim() || `@${handle}`;
          const avatar = String(m?.avatar || "").trim();
          return (
            <button
              key={`mention-suggest-${handle}`}
              type="button"
              className="mention-autocomplete-row"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect && onSelect(m)}
              title={`Use @${handle}`}
            >
              {avatar ? (
                <img className="mention-chip-avatar" src={avatar} alt={name} loading="lazy" />
              ) : (
                <span className="mention-chip-avatar placeholder" aria-hidden="true"></span>
              )}
              <span className="mention-autocomplete-text">
                <span className="mention-chip-text">@{handle}</span>
                <span className="mention-chip-name">{name}</span>
              </span>
            </button>
          );
        })
      ) : (
        <div className="mention-autocomplete-row muted">{emptyLabel}</div>
      )}
    </div>
  );
}

export default MentionAutocomplete;

