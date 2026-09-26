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

async function save(format: 'csv' | 'json', products: Products) {
  try {
    const { blob, fileName } = await fetchExport(format, products);
    saveFile(blob, fileName);
  } catch (error) {
    toast.error("Couldn't export", { description: errorMessage(error) });
  }
}

/**
 * Downloads products as CSV or JSON (see fetchExport): the picked ones, or else every one the
 * search and filter match, loaded or not. `label` says which, at the top of the menu.
 */
export function ExportMenu({ products, label }: { products: Products; label: string }) {
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
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void save('csv', products)}>
          <FileSpreadsheet aria-hidden />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void save('json', products)}>
          <FileJson aria-hidden />
          JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
