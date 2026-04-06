import { useState, useRef, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  Search,
  Upload,
  Download,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { downloadText } from '@/lib/utils';
import { usePromptStore } from '@/stores/promptStore';
import type { Prompt } from '@/types';

export function PromptManager() {
  const {
    prompts,
    addPrompt,
    updatePrompt,
    deletePrompt,
    copyPrompt,
    importPrompts,
    searchPrompts,
    getAllTags,
  } = usePromptStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({ name: '', content: '', tags: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allTags = getAllTags();

  const filteredPrompts = (() => {
    let result = searchQuery ? searchPrompts(searchQuery) : prompts;
    if (selectedTag) {
      result = result.filter((p) => p.tags.includes(selectedTag));
    }
    return result;
  })();

  const openAddDialog = () => {
    setEditingPrompt(null);
    setFormData({ name: '', content: '', tags: '' });
    setDialogOpen(true);
  };

  const openEditDialog = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setFormData({
      name: prompt.name,
      content: prompt.content,
      tags: prompt.tags.join(', '),
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    const tags = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingPrompt) {
      updatePrompt(editingPrompt.id, {
        name: formData.name.trim(),
        content: formData.content.trim(),
        tags,
      });
    } else {
      addPrompt({
        name: formData.name.trim(),
        content: formData.content.trim(),
        tags,
      });
    }
    setDialogOpen(false);
  };

  const handleImport = useCallback(
    (text: string) => {
      try {
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : [data];
        importPrompts(arr);
      } catch {
        // ignore invalid JSON
      }
    },
    [importPrompts],
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

  const handleExport = () => {
    downloadText(JSON.stringify(prompts, null, 2), 'prompts.json', 'application/json');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4" />
            Prompts ({prompts.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={openAddDialog} className="gap-1">
              <Plus className="h-3 w-3" />
              Neu
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1"
            >
              <Upload className="h-3 w-3" />
              Import
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
              onChange={handleFileUpload}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Prompts suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <Badge
                variant={selectedTag === null ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => setSelectedTag(null)}
              >
                Alle
              </Badge>
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTag === tag ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Prompt list */}
          <ScrollArea className="h-96">
            <div className="space-y-2">
              {filteredPrompts.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Keine Prompts gefunden
                </p>
              )}
              {filteredPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="group rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-medium">{prompt.name}</h4>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {prompt.content}
                      </p>
                      {prompt.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {prompt.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => openEditDialog(prompt)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => copyPrompt(prompt.id)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deletePrompt(prompt.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPrompt ? 'Prompt bearbeiten' : 'Neuer Prompt'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="Prompt-Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Inhalt</Label>
              <Textarea
                placeholder="Prompt-Inhalt... Verwende {text} als Platzhalter für den Transkriptionstext."
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                rows={8}
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (kommagetrennt)</Label>
              <Input
                placeholder="korrektur, standard, arztbrief"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleSave} disabled={!formData.name.trim() || !formData.content.trim()}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
