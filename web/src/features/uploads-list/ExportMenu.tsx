import { ChevronDown, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Downloads every completed extraction. Plain links: the API answers with a file attachment, so
 * the browser saves it without any JavaScript download handling.
 */
export function ExportMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download data-icon="inline-start" aria-hidden />
          Export
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">All completed uploads</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href="/api/exports/uploads.csv" download>
            <FileSpreadsheet aria-hidden />
            CSV
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/api/exports/uploads.json" download>
            <FileJson aria-hidden />
            JSON
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
