import { useState, useRef, useCallback } from 'react';
import type { RecordingState } from '@/types';

interface UseRecordingOptions {
  deviceId?: string;
  onDataAvailable?: (blob: Blob) => void;
}

export function useRecording(options: UseRecordingOptions = {}) {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const pausedDurationRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setDuration(
        pausedDurationRef.current + (Date.now() - startTimeRef.current) / 1000
      );
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    chunksRef.current = [];
    pausedDurationRef.current = 0;
    setDuration(0);

    const constraints: MediaStreamConstraints = {
      audio: options.deviceId
        ? { deviceId: { exact: options.deviceId } }
        : true,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      options.onDataAvailable?.(blob);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(1000);
    setState('recording');
    startTimer();
  }, [options, startTimer]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setState('paused');
      pausedDurationRef.current += (Date.now() - startTimeRef.current) / 1000;
      stopTimer();
    }
  }, [stopTimer]);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setState('recording');
      startTimer();
    }
  }, [startTimer]);

  const stop = useCallback(() => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
    stopTimer();
  }, [stopTimer]);

  const getStream = useCallback(() => streamRef.current, []);

  return {
    state,
    duration,
    start,
    pause,
    resume,
    stop,
    getStream,
  };
}
