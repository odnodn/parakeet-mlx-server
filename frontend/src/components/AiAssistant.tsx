import { useState, useCallback } from 'react';
import { Send, Copy, Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { usePromptStore } from '@/stores/promptStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { sendToOpenAI } from '@/services/openaiService';

interface AiAssistantProps {
  transcriptText: string;
}

export function AiAssistant({ transcriptText }: AiAssistantProps) {
  const { prompts } = usePromptStore();
  const { settings } = useSettingsStore();

  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);

  const getEffectivePrompt = useCallback((): string => {
    const template = selectedPrompt?.content || customPrompt;
    if (!template.trim()) return '';

    if (template.includes('{text}')) {
      return template.replace(/\{text\}/g, transcriptText);
    }
    return `${template}\n\n${transcriptText}`;
  }, [selectedPrompt, customPrompt, transcriptText]);

  const handleSend = async () => {
    const prompt = getEffectivePrompt();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setError(null);
    setResponse('');

    try {
      const result = await sendToOpenAI(
        [{ role: 'user', content: prompt }],
        {
          apiUrl: settings.openaiApiUrl,
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel,
          onStream: (text) => {
            setResponse(text);
          },
        },
      );
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(response);
  };

  const hasApiConfig = settings.openaiApiUrl && settings.openaiApiKey;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            KI-Assistent
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasApiConfig && (
            <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
              Bitte konfiguriere die OpenAI API-Einstellungen unter Einstellungen.
            </div>
          )}

          {/* Transcript info */}
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              Transkriptionstext ({transcriptText.length} Zeichen)
              {!transcriptText && ' – Kein Text vorhanden'}
            </p>
            {transcriptText && (
              <p className="mt-1 line-clamp-3 text-sm">{transcriptText}</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Verwende <code className="rounded bg-muted-foreground/10 px-1">{'{text}'}</code> im
              Prompt als Platzhalter für den Transkriptionstext.
            </p>
          </div>

          {/* Prompt selection */}
          <div className="space-y-2">
            <Label>Prompt wählen</Label>
            <div className="flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <Badge
                  key={prompt.id}
                  variant={selectedPromptId === prompt.id ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedPromptId(
                      selectedPromptId === prompt.id ? null : prompt.id,
                    );
                    if (selectedPromptId !== prompt.id) setCustomPrompt('');
                  }}
                >
                  {prompt.name}
                </Badge>
              ))}
            </div>
          </div>

          {/* Selected prompt preview */}
          {selectedPrompt && (
            <div className="rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {selectedPrompt.name}
              </p>
              <p className="mt-1 text-sm">{selectedPrompt.content}</p>
            </div>
          )}

          {/* Custom prompt */}
          {!selectedPrompt && (
            <div className="space-y-2">
              <Label>Eigener Prompt</Label>
              <Textarea
                placeholder="Schreibe deinen Prompt hier... Verwende {text} als Platzhalter."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={4}
              />
            </div>
          )}

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={
              isLoading ||
              !hasApiConfig ||
              !transcriptText ||
              (!selectedPrompt && !customPrompt.trim())
            }
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isLoading ? 'Wird verarbeitet...' : 'Senden'}
          </Button>
        </CardContent>
      </Card>

      {/* Response */}
      {(response || error) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Antwort</CardTitle>
            {response && (
              <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1">
                <Copy className="h-4 w-4" />
                Kopieren
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : (
              <ScrollArea className="h-80">
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {response}
                  {isLoading && (
                    <span className="inline-block h-4 w-1 animate-pulse bg-foreground ml-0.5" />
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
