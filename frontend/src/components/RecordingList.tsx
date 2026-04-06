import { useState } from 'react';
import { Pencil, Trash2, Check, X, FileAudio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, formatTimestamp, formatDate } from '@/lib/utils';
import { useRecordingStore } from '@/stores/recordingStore';
import { usePatientStore } from '@/stores/patientStore';

interface RecordingListProps {
  selectedRecordingId: string | null;
  onSelectRecording: (id: string) => void;
}

export function RecordingList({ selectedRecordingId, onSelectRecording }: RecordingListProps) {
  const { recordings, updateRecording, deleteRecording } = useRecordingStore();
  const { selectedPatientId, patients } = usePatientStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const filteredRecordings = selectedPatientId
    ? recordings.filter((r) => r.patientId === selectedPatientId)
    : recordings;

  const sortedRecordings = [...filteredRecordings].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const selectedPatient = patients.find((p) => p.id === selectedPatientId);

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const handleSaveEdit = (id: string) => {
    updateRecording(id, { name: editName.trim() });
    setEditingId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileAudio className="h-4 w-4" />
          Aufnahmen ({sortedRecordings.length})
        </CardTitle>
        {selectedPatient && (
          <Badge variant="secondary">
            {selectedPatient.name}, {selectedPatient.vorname}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {sortedRecordings.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {selectedPatientId
              ? 'Keine Aufnahmen für diesen Patienten'
              : 'Keine Aufnahmen vorhanden'}
          </p>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-1">
              {sortedRecordings.map((recording) => {
                const patient = recording.patientId
                  ? patients.find((p) => p.id === recording.patientId)
                  : null;

                return (
                  <div
                    key={recording.id}
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer transition-colors',
                      selectedRecordingId === recording.id
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted',
                    )}
                    onClick={() => onSelectRecording(recording.id)}
                  >
                    {editingId === recording.id ? (
                      <div className="flex flex-1 items-center gap-2">
                        <Input
                          className="h-7 flex-1"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(recording.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveEdit(recording.id);
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
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{recording.name}</span>
                            {recording.transcription && (
                              <Badge variant="outline" className="shrink-0 text-xs">
                                Transkribiert
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-3 text-xs text-muted-foreground">
                            <span>{formatTimestamp(recording.duration)}</span>
                            <span>{formatDate(recording.createdAt)}</span>
                            {patient && !selectedPatientId && (
                              <span>
                                {patient.name}, {patient.vorname}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(recording.id, recording.name);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRecording(recording.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
