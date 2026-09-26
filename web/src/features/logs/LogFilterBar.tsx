import { Link, type NavigateOptions } from 'react-router';
import { X } from 'lucide-react';
import { LOG_EVENT_TYPE_IDS } from '@label-extractor/shared';
import type { LogFilters } from '@/api/logs';
import { Button } from '@/components/ui/button';
import { ActivityFilterBar } from '@/features/activity/ActivityFilterBar';
import { uploadPath } from '@/routes';

interface LogFilterBarProps {
  filters: LogFilters;
  onChange: (changes: Partial<LogFilters>, options?: NavigateOptions) => void;
  /** The file name of the upload the log is narrowed to, once its events have loaded. */
  uploadName: string | null;
}

/**
 * The log's filters: words to search for, which types of event to show, which days, and the
 * upload it's narrowed to, if any (a chip, removable).
 */
export function LogFilterBar({ filters, onChange, uploadName }: LogFilterBarProps) {
  return (
    <ActivityFilterBar
      filters={filters}
      onChange={onChange}
      types={LOG_EVENT_TYPE_IDS}
      searchLabel="Search the activity log"
      searchPlaceholder="Search by file, person or message"
    >
      {filters.upload && <UploadChip id={filters.upload} name={uploadName} onClear={() => onChange({ upload: null })} />}
    </ActivityFilterBar>
  );
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
