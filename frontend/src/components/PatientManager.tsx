import { useState, useCallback, useRef } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Upload,
  Download,
  Check,
  X,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn, downloadText } from '@/lib/utils';
import { usePatientStore } from '@/stores/patientStore';
import type { Patient } from '@/types';

export function PatientManager() {
  const {
    patients,
    selectedPatientId,
    addPatient,
    updatePatient,
    deletePatient,
    selectPatient,
    importPatients,
  } = usePatientStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ id: '', name: '', vorname: '' });
  const [editData, setEditData] = useState({ name: '', vorname: '' });
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredPatients = patients.filter((p) => {
    const q = searchQuery.toLowerCase();
    return (
      p.id.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.vorname.toLowerCase().includes(q)
    );
  });

  const handleAdd = () => {
    if (!formData.name.trim() || !formData.vorname.trim()) return;
    addPatient({
      id: formData.id.trim() || undefined,
      name: formData.name.trim(),
      vorname: formData.vorname.trim(),
    });
    setFormData({ id: '', name: '', vorname: '' });
    setShowAddForm(false);
  };

  const handleStartEdit = (patient: Patient) => {
    setEditingId(patient.id);
    setEditData({ name: patient.name, vorname: patient.vorname });
  };

  const handleSaveEdit = (id: string) => {
    updatePatient(id, { name: editData.name.trim(), vorname: editData.vorname.trim() });
    setEditingId(null);
  };

  const handleImport = useCallback(
    (text: string) => {
      const lines = text.trim().split('\n').filter(Boolean);
      const parsed: Patient[] = [];

      // Try JSON first
      try {
        const json = JSON.parse(text);
        const arr = Array.isArray(json) ? json : [json];
        arr.forEach((item: Record<string, string>) => {
          if (item.name && item.vorname) {
            parsed.push({
              id: item.id || crypto.randomUUID(),
              name: item.name,
              vorname: item.vorname,
            });
          }
        });
      } catch {
        // CSV format: id,name,vorname
        for (const line of lines) {
          const parts = line.split(',').map((s) => s.trim());
          if (parts.length >= 3) {
            parsed.push({ id: parts[0], name: parts[1], vorname: parts[2] });
          } else if (parts.length === 2) {
            parsed.push({ id: crypto.randomUUID(), name: parts[0], vorname: parts[1] });
          }
        }
      }

      if (parsed.length > 0) {
        importPatients(parsed);
        setImportText('');
        setShowImport(false);
      }
    },
    [importPatients],
  );

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') handleImport(reader.result);
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [handleImport],
  );

  const handleExportCSV = () => {
    const csv = ['id,name,vorname', ...patients.map((p) => `${p.id},${p.name},${p.vorname}`)].join(
      '\n',
    );
    downloadText(csv, 'patienten.csv', 'text/csv');
  };

  const handleExportJSON = () => {
    downloadText(JSON.stringify(patients, null, 2), 'patienten.json', 'application/json');
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') handleImport(reader.result);
        };
        reader.readAsText(file);
      }
    },
    [handleImport],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Patienten ({patients.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImport(!showImport)}
              className="gap-1"
            >
              <Upload className="h-3 w-3" />
              Import
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1">
              <Download className="h-3 w-3" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportJSON} className="gap-1">
              <Download className="h-3 w-3" />
              JSON
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Patienten suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Import area */}
          {showImport && (
            <div
              className="space-y-2 rounded-lg border border-dashed p-3"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <Label>CSV oder JSON importieren</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"id,name,vorname\n001,Müller,Hans\n002,Schmidt,Maria"}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleImport(importText)}>
                  Importieren
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Datei wählen
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </div>
          )}

          {/* Add form */}
          {showAddForm ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">ID (optional)</Label>
                  <Input
                    placeholder="ID"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Nachname</Label>
                  <Input
                    placeholder="Nachname"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Vorname</Label>
                  <Input
                    placeholder="Vorname"
                    value={formData.vorname}
                    onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd}>
                  Hinzufügen
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="gap-1"
            >
              <Plus className="h-3 w-3" />
              Patient hinzufügen
            </Button>
          )}

          <Separator />

          {/* Patient list */}
          <ScrollArea className="h-80">
            <div className="space-y-1">
              {filteredPatients.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Keine Patienten gefunden
                </p>
              )}
              {filteredPatients.map((patient) => (
                <div
                  key={patient.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer transition-colors',
                    selectedPatientId === patient.id
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-muted',
                  )}
                  onClick={() => selectPatient(patient.id)}
                >
                  {editingId === patient.id ? (
                    <>
                      <Input
                        className="h-7 w-28"
                        value={editData.name}
                        onChange={(e) =>
                          setEditData({ ...editData, name: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Input
                        className="h-7 w-28"
                        value={editData.vorname}
                        onChange={(e) =>
                          setEditData({ ...editData, vorname: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit(patient.id);
                        }}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                        {patient.id.slice(0, 8)}
                      </span>
                      <span className="flex-1 font-medium">
                        {patient.name}, {patient.vorname}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(patient);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePatient(patient.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
