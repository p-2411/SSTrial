import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { UPLOAD_GONE_EVENT_TYPES, type LogEvent, type LogLevel } from '@label-extractor/shared';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { EVENT_ACTION_CLASS, EventDetails, EventDetailsTrigger } from '@/features/activity/EventDetails';
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
 * already says what happened), then, always in view on its right however long the message runs,
 * a link to its upload and its details (what a change did to the data, or the codes and numbers
 * the sentence leaves out), fetched only when opened. The two actions have fixed columns, so they
 * line up down the log.
 */
export function LogEventRow({ event }: { event: LogEvent }) {
  const badge = LEVEL_BADGE[event.level];
  // Rejected and discarded uploads are deleted, so there's nothing to open.
  const uploadId = event.uploadId !== null && !UPLOAD_GONE_EVENT_TYPES.includes(event.type) ? event.uploadId : null;

  return (
    <li className="border-b border-border/70">
      <Collapsible className="group/event grid grid-cols-[4.5rem_4.75rem_minmax(0,1fr)_5.5rem_3.75rem] items-baseline gap-x-3 px-5 py-2.5">
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
        <p className="min-w-0 text-sm break-words text-foreground">{event.message}</p>
        <span className="justify-self-end">
          {uploadId && (
            <Link to={uploadPath(uploadId)} className={EVENT_ACTION_CLASS}>
              <ArrowUpRight aria-hidden />
              View upload
            </Link>
          )}
        </span>
        <span className="justify-self-end">{event.hasDetails && <EventDetailsTrigger />}</span>
        <CollapsibleContent className="col-span-3 col-start-3 min-w-0">
          <EventDetails source={FROM_THE_LOG} eventId={event.id} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
