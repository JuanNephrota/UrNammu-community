"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** One-click suggestions shown below the input (already-added ones are hidden). */
  suggestions?: string[];
  "aria-label"?: string;
  id?: string;
}

/** A list field: type and press Enter (or comma) to add, click x to remove. */
export function TagInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  id,
  ...rest
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const generatedId = useId();
  const inputId = id ?? generatedId;

  function add(raw: string) {
    const items = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    const existing = new Set(value.map((item) => item.toLowerCase()));
    const next = [...value];
    for (const item of items) {
      if (!existing.has(item.toLowerCase())) {
        next.push(item);
        existing.add(item.toLowerCase());
      }
    }
    onChange(next);
    setDraft("");
  }

  const remaining = suggestions.filter(
    (suggestion) => !value.some((item) => item.toLowerCase() === suggestion.toLowerCase())
  );

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((item) => (
            <li
              key={item}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-0.5 pl-2 pr-1 text-sm text-[var(--text-primary)]"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(value.filter((entry) => entry !== item))}
                className="rounded p-0.5 text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                aria-label={`Remove ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={inputId}
        value={draft}
        placeholder={placeholder}
        aria-label={rest["aria-label"]}
        onChange={(e) => {
          const next = e.target.value;
          if (next.includes(",")) add(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]"
            >
              <Plus className="h-3 w-3" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
