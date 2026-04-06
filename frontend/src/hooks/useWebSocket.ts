import { useRef, useCallback, useState } from 'react';
import type { StreamChunk } from '@/types';
import { createWebSocketTranscription } from '@/services/transcriptionService';

interface UseWebSocketOptions {
  diarize?: boolean;
  numSpeakers?: number;
  speakerNames?: string[];
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [chunks, setChunks] = useState<StreamChunk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<ReturnType<
    typeof createWebSocketTranscription
  > | null>(null);

  const connect = useCallback(() => {
    setError(null);
    setChunks([]);

    const connection = createWebSocketTranscription({
      diarize: options.diarize,
      numSpeakers: options.numSpeakers,
      speakerNames: options.speakerNames,
      onMessage: (data: StreamChunk) => {
        setChunks((prev) => [...prev, data]);
      },
      onError: () => {
        setError('WebSocket connection error');
        setIsConnected(false);
      },
      onClose: () => {
        setIsConnected(false);
      },
    });

    connectionRef.current = connection;
    setIsConnected(true);
    return connection;
  }, [options.diarize, options.numSpeakers, options.speakerNames]);

  const send = useCallback((data: Blob | ArrayBuffer) => {
    connectionRef.current?.send(data);
  }, []);

  const disconnect = useCallback(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    setIsConnected(false);
  }, []);

  const fullText = chunks.map((c) => c.text).join(' ');

  return {
    isConnected,
    chunks,
    fullText,
    error,
    connect,
    send,
    disconnect,
  };
}
