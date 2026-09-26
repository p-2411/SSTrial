import { Link } from 'react-router';
import { UPLOAD_GONE_EVENT_TYPES, type LogEvent, type LogLevel } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { EventDetails, EventDetailsTrigger } from '@/features/activity/EventDetails';
import { formatDateTimeWithSeconds, formatTimeOfDay } from '@/lib/format';
import { TONE_CLASSES, type Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';
import { uploadPath } from '@/routes';

/** Only warnings and errors get a badge, so they stand out in a column of everyday events. */
const LEVEL_BADGE: Record<LogLevel, { label: string; tone: Tone } | null> = {
  info: null,
  warn: { label: 'Warning', tone: 'warning' },
  error: { label: 'Error', tone: 'danger' },
};

/** Details opened from the Logs page are fetched through the log's own endpoint. */
const FROM_THE_LOG = {};

/**
 * One event, written for the business rather than engineers: its time, level and message (which
 * already says what happened), then its details one click away (what a change did to the data, or
 * the codes and numbers the sentence leaves out), fetched only then, and a link to its upload.
 */
export function LogEventRow({ event }: { event: LogEvent }) {
  const badge = LEVEL_BADGE[event.level];
  // Rejected and discarded uploads are deleted, so there's nothing to open.
  const uploadId = event.uploadId !== null && !UPLOAD_GONE_EVENT_TYPES.includes(event.type) ? event.uploadId : null;

  return (
    <li className="border-b border-border/70">
      <Collapsible className="group/event grid grid-cols-[4.5rem_4.75rem_minmax(0,1fr)] items-baseline gap-x-3 px-5 py-2.5">
        <time
          dateTime={event.occurredAt}
          title={formatDateTimeWithSeconds(event.occurredAt)}
          className="text-sm text-muted-foreground tabular-nums"
        >
          {formatTimeOfDay(event.occurredAt)}
        </time>
        <span>
          {badge && (
            <Badge variant="outline" className={cn('rounded-full', TONE_CLASSES[badge.tone])}>
              {badge.label}
            </Badge>
          )}
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm break-words text-foreground">{event.message}</p>
          {(event.hasDetails || uploadId) && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {event.hasDetails && <EventDetailsTrigger />}
              {event.hasDetails && uploadId && <Dot />}
              {uploadId && (
                <Link to={uploadPath(uploadId)} className="font-medium text-brand hover:underline">
                  View upload
                </Link>
              )}
            </p>
          )}
          <CollapsibleContent>
            <EventDetails source={FROM_THE_LOG} eventId={event.id} />
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  );
}

function Dot() {
  return <span aria-hidden>·</span>;
}
