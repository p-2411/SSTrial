import { useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { UploadDetailView } from './UploadDetailView';

/**
 * One upload's details in a panel that slides over the list from the right.
 *
 * The URL drives it: /uploads/:id opens it, so links, refresh and the back button work; closing it
 * (Esc, the close button, or clicking outside) goes back to the list, keeping the status filter.
 * It's always mounted, so it can animate out instead of vanishing when the route changes.
 */
export function UploadDetailSheet() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const id = useMatch('/uploads/:id')?.params.id;

  // Keep rendering the last upload while the panel slides closed (the route has already changed).
  const [shownId, setShownId] = useState(id);
  if (id && id !== shownId) setShownId(id);

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && navigate({ pathname: '/', search })}>
      <SheetContent
        side="right"
        // The detail has a title (the file name) but no separate description.
        aria-describedby={undefined}
        className="gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {/* Scrolls inside the panel, so the close button stays put. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{shownId && <UploadDetailView id={shownId} />}</div>
      </SheetContent>
    </Sheet>
  );
}
