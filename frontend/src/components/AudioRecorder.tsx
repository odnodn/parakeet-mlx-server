import { useState, useCallback, useRef } from 'react';
import { Mic, Square, Pause, Play, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn, formatTimestamp } from '@/lib/utils';
import { useMicrophone } from '@/hooks/useMicrophone';
import { useRecording } from '@/hooks/useRecording';

interface AudioRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
}

export function AudioRecorder({ onRecordingComplete }: AudioRecorderProps) {
  const { devices, selectedDeviceId, setSelectedDeviceId, hasPermission, refreshDevices } =
    useMicrophone();
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDataAvailable = useCallback(
    (blob: Blob) => {
      setRecordedBlob(blob);
      onRecordingComplete(blob);
    },
    [onRecordingComplete],
  );

  const { state, duration, start, pause, resume, stop } = useRecording({
    deviceId: selectedDeviceId,
    onDataAvailable: handleDataAvailable,
  });

  const handleFileUpload = useCallback(
    (file: File) => {
      if (file.type.startsWith('audio/') || file.name.match(/\.(wav|mp3|m4a|ogg|webm|flac)$/i)) {
        setRecordedBlob(file);
        onRecordingComplete(file);
      }
    },
    [onRecordingComplete],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileUpload(file);
      e.target.value = '';
    },
    [handleFileUpload],
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Microphone selection */}
        <div className="space-y-2">
          <Label>Mikrofon</Label>
          <div className="flex gap-2">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={state !== 'idle'}
            >
              {devices.length === 0 && (
                <option value="">Kein Mikrofon gefunden</option>
              )}
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Mikrofon ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={refreshDevices} disabled={state !== 'idle'}>
              Aktualisieren
            </Button>
          </div>
          {!hasPermission && (
            <p className="text-sm text-muted-foreground">
              Mikrofonzugriff wird beim Start der Aufnahme angefragt.
            </p>
          )}
        </div>

        {/* Recording controls */}
        <div className="flex items-center gap-4">
          {state === 'idle' && (
            <Button onClick={start} size="lg" className="gap-2">
              <Mic className="h-5 w-5" />
              Aufnahme starten
            </Button>
          )}

          {state === 'recording' && (
            <>
              <Button onClick={pause} variant="outline" size="lg" className="gap-2">
                <Pause className="h-5 w-5" />
                Pause
              </Button>
              <Button onClick={stop} variant="destructive" size="lg" className="gap-2">
                <Square className="h-5 w-5" />
                Stopp
              </Button>
            </>
          )}

          {state === 'paused' && (
            <>
              <Button onClick={resume} variant="outline" size="lg" className="gap-2">
                <Play className="h-5 w-5" />
                Fortsetzen
              </Button>
              <Button onClick={stop} variant="destructive" size="lg" className="gap-2">
                <Square className="h-5 w-5" />
                Stopp
              </Button>
            </>
          )}

          {/* Duration & indicator */}
          {state !== 'idle' && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-3 w-3 rounded-full',
                  state === 'recording' && 'animate-pulse bg-red-500',
                  state === 'paused' && 'bg-yellow-500',
                )}
              />
              <span className="font-mono text-lg">{formatTimestamp(duration)}</span>
            </div>
          )}
        </div>

        {/* File upload / drop zone */}
        <div
          className={cn(
            'rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer',
            isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
            state !== 'idle' && 'pointer-events-none opacity-50',
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => state === 'idle' && fileInputRef.current?.click()}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Audiodatei hierher ziehen oder klicken zum Hochladen
          </p>
          <p className="text-xs text-muted-foreground">WAV, MP3, M4A, OGG, WebM, FLAC</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {recordedBlob && state === 'idle' && (
          <p className="text-sm text-muted-foreground">
            ✓ Aufnahme bereit ({(recordedBlob.size / 1024).toFixed(1)} KB)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
