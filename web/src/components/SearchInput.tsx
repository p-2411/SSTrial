import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** How long typing has to pause before a search runs: long enough not to search every letter. */
export const SEARCH_DELAY_MS = 300;

/** The longest search the server takes. */
export const MAX_SEARCH_LENGTH = 200;

interface SearchInputProps {
  /** The search in effect. */
  value: string;
  /** Runs a search: the words typed, trimmed. */
  onSearch: (search: string) => void;
  label: string;
  placeholder: string;
  className?: string;
}

/**
 * A search box that searches once typing pauses (or at once, on Enter). It follows `value` too, so
 * a search cleared or changed elsewhere (Back, "Clear filters") shows here.
 */
export function SearchInput({ value, onSearch, label, placeholder, className }: SearchInputProps) {
  const [text, setText] = useState(value);
  const [searched, setSearched] = useState(value);
  // The search changed without typing here: show it. (Not when it's just this text, searched.)
  if (value !== searched) {
    setSearched(value);
    if (value !== text.trim()) setText(value);
  }

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const search = (next: string, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next.trim() !== value) onSearch(next.trim());
    }, delay);
  };

  return (
    <div className={cn('relative w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        maxLength={MAX_SEARCH_LENGTH}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          search(event.target.value, SEARCH_DELAY_MS);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') search(text, 0);
        }}
        className="h-9 bg-card pl-8 shadow-xs"
      />
    </div>
  );
}
