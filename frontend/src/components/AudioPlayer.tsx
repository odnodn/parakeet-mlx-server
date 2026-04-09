import { useRef, useEffect, useCallback, useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatTimestamp } from '@/lib/utils';
import { usePlayback } from '@/hooks/usePlayback';
import { drawWaveform, createAudioContext } from '@/services/audioService';

interface AudioPlayerProps {
  blob: Blob | null;
  trimStart?: number;
  trimEnd?: number;
  onTrimStartChange?: (value: number) => void;
  onTrimEndChange?: (value: number) => void;
}

export function AudioPlayer({
  blob,
  trimStart = 0,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
}: AudioPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  const { state, currentTime, duration, load, play, pause, resume, stop, seek } =
    usePlayback();

  const effectiveTrimEnd = trimEnd ?? duration;

  // Load audio blob
  useEffect(() => {
    if (blob) {
      load(blob);

      const ctx = createAudioContext();
      blob.arrayBuffer().then((buf) => {
        ctx.decodeAudioData(buf).then((decoded) => {
          setAudioBuffer(decoded);
        });
      });
    }
  }, [blob, load]);

  const renderWaveform = useCallback(() => {
    if (!canvasRef.current || !audioBuffer) return;
    drawWaveform(canvasRef.current, audioBuffer, {
      color: '#1d4ed8',
      backgroundColor: '#f1f5f9',
      trimStart,
      trimEnd: effectiveTrimEnd,
      currentTime,
    });
  }, [audioBuffer, trimStart, effectiveTrimEnd, currentTime]);

  useEffect(() => {
    renderWaveform();
  }, [renderWaveform]);

  // Click on waveform to seek
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || duration === 0) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      const time = ratio * duration;
      seek(time);
    },
    [duration, seek],
  );

  // Trim handle drag
  const handleTrimMouseDown = useCallback(
    (handle: 'start' | 'end') => (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(handle);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current || duration === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const time = (x / rect.width) * duration;

      if (dragging === 'start' && onTrimStartChange) {
        onTrimStartChange(Math.min(time, effectiveTrimEnd - 0.1));
      } else if (dragging === 'end' && onTrimEndChange) {
        onTrimEndChange(Math.max(time, trimStart + 0.1));
      }
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, duration, trimStart, effectiveTrimEnd, onTrimStartChange, onTrimEndChange]);

  if (!blob) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Keine Audiodatei geladen
        </CardContent>
      </Card>
    );
  }

  const trimStartPercent = duration > 0 ? (trimStart / duration) * 100 : 0;
  const trimEndPercent = duration > 0 ? (effectiveTrimEnd / duration) * 100 : 100;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        {/* Waveform */}
        <div ref={containerRef} className="relative select-none">
          <canvas
            ref={canvasRef}
            className="h-20 w-full cursor-pointer rounded"
            onClick={handleCanvasClick}
          />

          {/* Trim handles */}
          {(onTrimStartChange || onTrimEndChange) && duration > 0 && (
            <>
              {/* Dimmed regions */}
              <div
                className="pointer-events-none absolute top-0 left-0 h-full bg-black/20 rounded-l"
                style={{ width: `${trimStartPercent}%` }}
              />
              <div
                className="pointer-events-none absolute top-0 right-0 h-full bg-black/20 rounded-r"
                style={{ width: `${100 - trimEndPercent}%` }}
              />

              {/* Start handle */}
              {onTrimStartChange && (
                <div
                  className="absolute top-0 h-full w-1.5 cursor-col-resize bg-blue-600 hover:bg-blue-500"
                  style={{ left: `${trimStartPercent}%` }}
                  onMouseDown={handleTrimMouseDown('start')}
                  title={`Start: ${formatTimestamp(trimStart)}`}
                />
              )}

              {/* End handle */}
              {onTrimEndChange && (
                <div
                  className="absolute top-0 h-full w-1.5 cursor-col-resize bg-blue-600 hover:bg-blue-500"
                  style={{ left: `${trimEndPercent}%` }}
                  onMouseDown={handleTrimMouseDown('end')}
                  title={`Ende: ${formatTimestamp(effectiveTrimEnd)}`}
                />
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {state === 'idle' && (
            <Button onClick={() => play(trimStart)} size="sm" variant="outline" className="gap-1">
              <Play className="h-4 w-4" />
              Abspielen
            </Button>
          )}

          {state === 'playing' && (
            <Button onClick={pause} size="sm" variant="outline" className="gap-1">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
          )}

          {state === 'paused' && (
            <Button onClick={resume} size="sm" variant="outline" className="gap-1">
              <Play className="h-4 w-4" />
              Fortsetzen
            </Button>
          )}

          {state !== 'idle' && (
            <Button onClick={stop} size="sm" variant="ghost" className="gap-1">
              <Square className="h-4 w-4" />
              Stopp
            </Button>
          )}

          <span className="ml-auto font-mono text-sm text-muted-foreground">
            {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
          </span>
        </div>

        {/* Trim info */}
        {(onTrimStartChange || onTrimEndChange) && duration > 0 && (
          <p className="text-xs text-muted-foreground">
            Trim: {formatTimestamp(trimStart)} – {formatTimestamp(effectiveTrimEnd)}
            {' '}({formatTimestamp(effectiveTrimEnd - trimStart)})
          </p>
        )}
      </CardContent>
    </Card>
  );
}
