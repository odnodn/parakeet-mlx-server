import { useState, useCallback, useRef } from 'react';
import { Plus, Trash2, Upload, Download, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { downloadText } from '@/lib/utils';
import { useMedicalTermsStore } from '@/stores/medicalTermsStore';

const CATEGORIES = ['Medikament', 'Diagnose', 'Prozedur', 'Sonstiges'] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Medikament: 'bg-blue-100 text-blue-800',
  Diagnose: 'bg-red-100 text-red-800',
  Prozedur: 'bg-green-100 text-green-800',
  Sonstiges: 'bg-gray-100 text-gray-800',
};

export function MedicalTerms() {
  const { terms, addTerm, deleteTerm, importTerms, exportTerms } = useMedicalTermsStore();

  const [newTerm, setNewTerm] = useState('');
  const [newCategory, setNewCategory] = useState<string>(CATEGORIES[0]);
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupedTerms = CATEGORIES.reduce(
    (acc, cat) => {
      const catTerms = terms.filter((t) => t.category === cat);
      if (catTerms.length > 0) acc[cat] = catTerms;
      return acc;
    },
    {} as Record<string, typeof terms>,
  );

  // Also include any categories not in the standard list
  terms.forEach((t) => {
    if (!CATEGORIES.includes(t.category as (typeof CATEGORIES)[number])) {
      if (!groupedTerms[t.category]) groupedTerms[t.category] = [];
      if (!groupedTerms[t.category].find((x) => x.id === t.id)) {
        groupedTerms[t.category].push(t);
      }
    }
  });

  const handleAdd = () => {
    if (!newTerm.trim()) return;
    addTerm({ term: newTerm.trim(), category: newCategory });
    setNewTerm('');
  };

  const handleBulkImport = () => {
    const lines = bulkText.trim().split('\n').filter(Boolean);
    const parsed = lines.map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      return {
        id: crypto.randomUUID(),
        term: parts[0],
        category: parts[1] || 'Sonstiges',
      };
    });
    if (parsed.length > 0) {
      importTerms(parsed);
      setBulkText('');
      setShowBulk(false);
    }
  };

  const handleFileImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') return;
        try {
          const data = JSON.parse(reader.result);
          importTerms(Array.isArray(data) ? data : [data]);
        } catch {
          // ignore
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [importTerms],
  );

  const handleExport = () => {
    const data = exportTerms();
    downloadText(JSON.stringify(data, null, 2), 'fachbegriffe.json', 'application/json');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" />
            Fachbegriffe ({terms.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBulk(!showBulk)}
              className="gap-1"
            >
              <Upload className="h-3 w-3" />
              Bulk
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1"
            >
              <Upload className="h-3 w-3" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1">
              <Download className="h-3 w-3" />
              Export
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileImport}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add term */}
          <div className="flex gap-2">
            <Input
              placeholder="Fachbegriff eingeben..."
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="flex-1"
            />
            <select
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <Button onClick={handleAdd} size="sm" className="gap-1">
              <Plus className="h-4 w-4" />
              Hinzufügen
            </Button>
          </div>

          {/* Bulk import */}
          {showBulk && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <Label>Bulk-Import (ein Begriff pro Zeile, Format: Begriff,Kategorie)</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"Amoxicillin,Medikament\nDiabetes mellitus,Diagnose\nAppendektomie,Prozedur"}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
              <Button size="sm" onClick={handleBulkImport}>
                Importieren
              </Button>
            </div>
          )}

          <Separator />

          {/* Terms grouped by category */}
          <ScrollArea className="h-80">
            {Object.keys(groupedTerms).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Keine Fachbegriffe vorhanden
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedTerms).map(([category, catTerms]) => (
                  <div key={category}>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={CATEGORY_COLORS[category] || CATEGORY_COLORS['Sonstiges']}
                      >
                        {category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        ({catTerms.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {catTerms.map((term) => (
                        <Badge
                          key={term.id}
                          variant="secondary"
                          className="group gap-1 pr-1"
                        >
                          {term.term}
                          <button
                            className="ml-1 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-destructive/20 group-hover:opacity-100"
                            onClick={() => deleteTerm(term.id)}
                          >
                            <Trash2 className="h-2.5 w-2.5 text-destructive" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
