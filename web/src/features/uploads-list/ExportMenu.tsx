import { ChevronDown, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { downloadExport } from '@/api/uploads';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

async function save(format: 'csv' | 'json') {
  try {
    await downloadExport(format);
  } catch (error) {
    toast.error("Couldn't export", { description: errorMessage(error) });
  }
}

/** Downloads every completed extraction, as CSV or JSON (see downloadExport). */
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
        <DropdownMenuItem onSelect={() => void save('csv')}>
          <FileSpreadsheet aria-hidden />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save('json')}>
          <FileJson aria-hidden />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
