import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectProps {
  id: string;
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function normalize(value: string) {
  return value.toLowerCase().trim();
}

export function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Search…',
  disabled = false,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return options.slice(0, 80);
    return options
      .filter((option) =>
        normalize(`${option.label} ${option.description ?? ''} ${option.value}`).includes(normalizedQuery)
      )
      .slice(0, 80);
  }, [options, query]);

  return (
    <div ref={rootRef} className="relative space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && open && visibleOptions[0]) {
            event.preventDefault();
            onChange(visibleOptions[0].value);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open && !disabled && (
        <div
          id={`${id}-options`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-popover p-1 shadow-lg"
        >
          {visibleOptions.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No matches</p>
          ) : (
            visibleOptions.map((option) => (
              <button
                key={`${option.value || '__empty__'}-${option.label}-${option.description ?? ''}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  option.value === value ? 'bg-primary/10 text-foreground' : 'hover:bg-muted'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span className="block font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
