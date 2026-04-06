import { useMemo } from 'react';
import { Copy, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, formatTimestamp } from '@/lib/utils';
import type { TranscriptionResult } from '@/types';

interface TranscriptionViewProps {
  result: TranscriptionResult | null;
  streamText?: string;
  isTranscribing?: boolean;
}

const SPEAKER_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
  'bg-teal-100 text-teal-800',
  'bg-yellow-100 text-yellow-800',
  'bg-red-100 text-red-800',
];

function getSpeakerColor(speaker: string, allSpeakers: string[]): string {
  const index = allSpeakers.indexOf(speaker);
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

export function TranscriptionView({
  result,
  streamText,
  isTranscribing,
}: TranscriptionViewProps) {
  const allSpeakers = useMemo(() => {
    if (!result?.speakers) return [];
    return Array.from(new Set(result.speakers.map((s) => s.speaker)));
  }, [result?.speakers]);

  const handleCopy = () => {
    const text = result?.text || streamText || '';
    navigator.clipboard.writeText(text);
  };

  // Streaming mode: show live text
  if (isTranscribing && streamText) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Transkription (live)
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            <span className="text-sm text-muted-foreground">Wird transkribiert...</span>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{streamText}</p>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {isTranscribing ? (
            <div className="flex flex-col items-center gap-2">
              <span className="h-3 w-3 animate-pulse rounded-full bg-blue-500" />
              <span>Transkription läuft...</span>
            </div>
          ) : (
            'Keine Transkription vorhanden'
          )}
        </CardContent>
      </Card>
    );
  }

  const hasSpeakers = result.speakers && result.speakers.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Transkription
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1">
          <Copy className="h-4 w-4" />
          Kopieren
        </Button>
      </CardHeader>
      <CardContent>
        {/* Speaker legend */}
        {hasSpeakers && allSpeakers.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {allSpeakers.map((speaker) => {
              const label =
                result.speaker_labels?.[allSpeakers.indexOf(speaker)] || speaker;
              return (
                <Badge
                  key={speaker}
                  variant="outline"
                  className={cn('text-xs', getSpeakerColor(speaker, allSpeakers))}
                >
                  {label}
                </Badge>
              );
            })}
          </div>
        )}

        <ScrollArea className="h-80">
          {hasSpeakers ? (
            <div className="space-y-2">
              {result.speakers!.map((segment, i) => {
                const label =
                  result.speaker_labels?.[allSpeakers.indexOf(segment.speaker)] ||
                  segment.speaker;
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground pt-0.5">
                      {formatTimestamp(segment.start)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 text-xs',
                        getSpeakerColor(segment.speaker, allSpeakers),
                      )}
                    >
                      {label}
                    </Badge>
                    <span className="leading-relaxed">{segment.text}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.text}</p>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
