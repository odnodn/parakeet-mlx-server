import { useState, useRef, useCallback, useEffect } from 'react';
import type { PlaybackState } from '@/types';

interface UsePlaybackOptions {
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
}

export function usePlayback(options: UsePlaybackOptions = {}) {
  const [state, setState] = useState<PlaybackState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const load = useCallback(
    (blob: Blob) => {
      cleanup();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);

      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration === Infinity) {
          audio.currentTime = 1e101;
          audio.addEventListener('timeupdate', function handler() {
            audio.removeEventListener('timeupdate', handler);
            setDuration(audio.duration);
            audio.currentTime = 0;
          });
        } else {
          setDuration(audio.duration);
        }
      });

      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime);
        optionsRef.current.onTimeUpdate?.(audio.currentTime);
      });

      audio.addEventListener('ended', () => {
        setState('idle');
        setCurrentTime(0);
        optionsRef.current.onEnded?.();
      });

      audioRef.current = audio;
    },
    [cleanup]
  );

  const play = useCallback(
    (startTime?: number) => {
      if (audioRef.current) {
        if (startTime !== undefined) {
          audioRef.current.currentTime = startTime;
        }
        audioRef.current.play();
        setState('playing');
      }
    },
    []
  );

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      setState('playing');
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setState('idle');
      setCurrentTime(0);
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  return {
    state,
    currentTime,
    duration,
    load,
    play,
    pause,
    resume,
    stop,
    seek,
  };
}
