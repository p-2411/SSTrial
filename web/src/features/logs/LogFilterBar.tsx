import { Fragment } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ListFilter, X } from 'lucide-react';
import { LOG_EVENT_TYPE_IDS, LOG_EVENT_TYPES, type LogEventType } from '@label-extractor/shared';
import type { LogFilters } from '@/api/logs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uploadPath } from '@/routes';
import { inCatalogueOrder } from './logFilters';

interface LogFilterBarProps {
  filters: LogFilters;
  onChange: (changes: Partial<LogFilters>) => void;
  /** The file name of the upload the log is narrowed to, once its events have loaded. */
  uploadName: string | null;
}

/**
 * The log's filters: which types of event to show (one menu), and the upload it's narrowed to, if
 * any (a chip, removable).
 */
export function LogFilterBar({ filters, onChange, uploadName }: LogFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ShowMenu types={filters.types} onChange={(types) => onChange({ types })} />
      {filters.upload && <UploadChip id={filters.upload} name={uploadName} onClear={() => onChange({ upload: null })} />}
    </div>
  );
}

/** Which heading each type sits under in the menu. Keyed by type, so a new one needs a place here. */
const TYPE_GROUP = {
  'upload.created': 'Uploads',
  'upload.duplicate': 'Uploads',
  'upload.queued': 'Uploads',
  'upload.rejected': 'Uploads',
  'upload.discarded': 'Uploads',
  'upload.retry_requested': 'Uploads',
  'extraction.started': 'Extraction',
  'extraction.completed': 'Extraction',
  'extraction.retry_scheduled': 'Extraction',
  'extraction.failed': 'Extraction',
  'extraction.abandoned': 'Extraction',
  'ratelimit.paused': 'Extraction',
  'process.started': 'System',
} satisfies Record<LogEventType, string>;

/** The menu's sections of event types, in shared's order. */
const TYPE_MENU: Array<{ heading: string; types: LogEventType[] }> = [];
for (const type of LOG_EVENT_TYPE_IDS) {
  const heading = TYPE_GROUP[type];
  const section = TYPE_MENU.find((candidate) => candidate.heading === heading);
  if (section) section.types.push(type);
  else TYPE_MENU.push({ heading, types: [type] });
}

/**
 * Choices at the top of the menu, each a whole set of types. A type always has the same level, so
 * "warnings and errors" is just the types that are warnings or errors. Everything is no filter.
 */
const SHORTCUTS: Array<{ label: string; types: LogEventType[] }> = [
  { label: 'Everything', types: [] },
  { label: 'Warnings and errors', types: LOG_EVENT_TYPE_IDS.filter((type) => LOG_EVENT_TYPES[type].level !== 'info') },
  { label: 'Errors only', types: LOG_EVENT_TYPE_IDS.filter((type) => LOG_EVENT_TYPES[type].level === 'error') },
];

/** Both lists are in the catalogue's order, so comparing them in order is enough. */
const sameTypes = (a: LogEventType[], b: LogEventType[]) => a.length === b.length && a.every((type, i) => type === b[i]);

/** The button's summary of the choice: "Show everything", "Show errors only", "Show 3 types of event"… */
function describe(types: LogEventType[]): string {
  const shortcut = SHORTCUTS.find((candidate) => sameTypes(candidate.types, types));
  if (shortcut) return midSentence(shortcut.label);
  if (types.length === 1) return midSentence(LOG_EVENT_TYPES[types[0]!].label);
  return `${types.length} types of event`;
}

/**
 * Which types of event to show: any number of them, ticked in the menu (which stays open while you
 * tick), or a shortcut at the top that picks a whole set at once.
 */
function ShowMenu({ types, onChange }: { types: LogEventType[]; onChange: (types: LogEventType[]) => void }) {
  const toggle = (type: LogEventType, checked: boolean) =>
    onChange(inCatalogueOrder(checked ? [...types, type] : types.filter((selected) => selected !== type)));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <ListFilter data-icon="inline-start" aria-hidden />
          {/* The space keeps the accessible name "Show everything" rather than "Showeverything". */}
          <span className="font-normal">Show</span> {describe(types)}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {SHORTCUTS.map((shortcut) => (
          <DropdownMenuCheckboxItem
            key={shortcut.label}
            checked={sameTypes(shortcut.types, types)}
            onCheckedChange={() => onChange(shortcut.types)}
          >
            {shortcut.label}
          </DropdownMenuCheckboxItem>
        ))}
        {TYPE_MENU.map(({ heading, types: group }) => (
          <Fragment key={heading}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{heading}</DropdownMenuLabel>
            {group.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={types.includes(type)}
                onCheckedChange={(checked) => toggle(type, checked)}
                // Keep the menu open, so several types can be ticked in one go.
                onSelect={(event) => event.preventDefault()}
              >
                {LOG_EVENT_TYPES[type].label}
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A label as it reads after "Show": "Errors only" → "errors only", but "AI requests paused" stays. */
function midSentence(label: string): string {
  const firstWord = label.split(' ')[0]!;
  return firstWord === firstWord.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

function UploadChip({ id, name, onClear }: { id: string; name: string | null; onClear: () => void }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card pr-1 pl-3 text-sm shadow-xs">
      <span className="text-muted-foreground">Upload</span>
      <Link to={uploadPath(id)} className="max-w-60 truncate font-medium hover:underline" title={name ?? undefined}>
        {name ?? 'Selected upload'}
      </Link>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClear} aria-label="Show events for every upload">
        <X aria-hidden />
      </Button>
    </span>
  );
}
