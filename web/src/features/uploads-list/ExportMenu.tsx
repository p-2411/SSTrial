import { useState } from 'react';
import { ChevronDown, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { fetchExport, type ProductFilter } from '@/api/uploads';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { saveFile } from '@/lib/saveFile';

type Products = { ids: string[] } | ProductFilter;
type Format = 'csv' | 'json';

/**
 * Downloads products as CSV or JSON (see fetchExport): the picked ones, or else every one the
 * search and filter match, loaded or not. `label` says which, at the top of the menu. While an
 * export is being prepared, the button spins and can't start another.
 */
export function ExportMenu({ products, label }: { products: Products; label: string }) {
  const [exporting, setExporting] = useState(false);

  const save = async (format: Format) => {
    setExporting(true);
    try {
      const { blob, fileName } = await fetchExport(format, products);
      saveFile(blob, fileName);
    } catch (error) {
      toast.error("Couldn't export", { description: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={exporting}>
        <Button variant="outline" size="sm" loading={exporting}>
          <Download data-icon="inline-start" aria-hidden />
          Export
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
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
