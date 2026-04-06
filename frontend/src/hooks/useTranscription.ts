import { useState, useCallback, useRef } from 'react';
import type { TranscriptionResult, StreamChunk } from '@/types';
import {
  transcribeAudio,
  transcribeStream,
  createWebSocketTranscription,
} from '@/services/transcriptionService';

export function useTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<ReturnType<typeof createWebSocketTranscription> | null>(
    null
  );

  const transcribe = useCallback(
    async (
      file: File | Blob,
      options: {
        diarize?: boolean;
        numSpeakers?: number;
        speakerNames?: string;
      } = {}
    ) => {
      setIsTranscribing(true);
      setError(null);
      setResult(null);
      try {
        const res = await transcribeAudio(file, options);
        setResult(res);
        return res;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Transcription failed';
        setError(message);
        throw err;
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const transcribeWithStream = useCallback(
    async (
      file: File | Blob,
      options: { chunkDuration?: number } = {}
    ) => {
      setIsTranscribing(true);
      setError(null);
      setStreamText('');
      try {
        let fullText = '';
        await transcribeStream(file, {
          chunkDuration: options.chunkDuration,
          onChunk: (chunk: StreamChunk) => {
            fullText += (fullText ? ' ' : '') + chunk.text;
            setStreamText(fullText);
          },
        });
        const finalResult: TranscriptionResult = { text: fullText };
        setResult(finalResult);
        return finalResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Streaming transcription failed';
        setError(message);
        throw err;
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const startWebSocket = useCallback(
    (options: {
      diarize?: boolean;
      numSpeakers?: number;
      speakerNames?: string[];
    } = {}) => {
      setError(null);
      setStreamText('');
      let fullText = '';

      const connection = createWebSocketTranscription({
        diarize: options.diarize,
        numSpeakers: options.numSpeakers,
        speakerNames: options.speakerNames,
        onMessage: (data: StreamChunk) => {
          fullText += (fullText ? ' ' : '') + data.text;
          setStreamText(fullText);
        },
        onError: () => {
          setError('WebSocket error');
        },
        onClose: () => {
          if (fullText) {
            setResult({ text: fullText });
          }
          setIsTranscribing(false);
        },
      });

      wsRef.current = connection;
      setIsTranscribing(true);
      return connection;
    },
    []
  );

  const stopWebSocket = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setStreamText('');
    setError(null);
    setIsTranscribing(false);
  }, []);

  return {
    isTranscribing,
    result,
    streamText,
    error,
    transcribe,
    transcribeWithStream,
    startWebSocket,
    stopWebSocket,
    reset,
  };
}
