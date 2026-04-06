import type { TranscriptionResult, StreamChunk } from '@/types';

const BASE_URL = '/v1';

export async function transcribeAudio(
  file: File | Blob,
  options: {
    diarize?: boolean;
    numSpeakers?: number;
    speakerNames?: string;
    responseFormat?: 'json' | 'text';
  } = {}
): Promise<TranscriptionResult> {
  const formData = new FormData();
  const audioFile = file instanceof File ? file : new File([file], 'recording.webm', { type: file.type || 'audio/webm' });
  formData.append('file', audioFile);
  formData.append('response_format', options.responseFormat || 'json');

  if (options.numSpeakers) {
    formData.append('num_speakers', String(options.numSpeakers));
  }
  if (options.speakerNames) {
    formData.append('speaker_names', options.speakerNames);
  }

  const endpoint = options.diarize
    ? `${BASE_URL}/audio/transcriptions/diarize`
    : `${BASE_URL}/audio/transcriptions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Transcription failed: ${error}`);
  }

  return response.json();
}

export async function transcribeStream(
  file: File | Blob,
  options: {
    chunkDuration?: number;
    onChunk: (chunk: StreamChunk) => void;
  }
): Promise<void> {
  const formData = new FormData();
  const audioFile = file instanceof File ? file : new File([file], 'recording.webm', { type: file.type || 'audio/webm' });
  formData.append('file', audioFile);
  if (options.chunkDuration) {
    formData.append('chunk_duration', String(options.chunkDuration));
  }

  const response = await fetch(`${BASE_URL}/audio/transcriptions/stream`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Streaming transcription failed: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const chunk: StreamChunk = JSON.parse(line);
          options.onChunk(chunk);
        } catch {
          // skip non-JSON lines
        }
      }
    }
  }

  if (buffer.trim()) {
    try {
      const chunk: StreamChunk = JSON.parse(buffer);
      options.onChunk(chunk);
    } catch {
      // skip non-JSON lines
    }
  }
}

export function createWebSocketTranscription(options: {
  onMessage: (data: StreamChunk) => void;
  onError: (error: Event) => void;
  onClose: () => void;
  diarize?: boolean;
  numSpeakers?: number;
  speakerNames?: string[];
}): {
  send: (data: Blob | ArrayBuffer) => void;
  close: () => void;
  ws: WebSocket;
} {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(
    `${protocol}//${window.location.host}${BASE_URL}/audio/transcriptions/ws`
  );

  ws.onopen = () => {
    const config: Record<string, unknown> = {};
    if (options.diarize) config.diarize = true;
    if (options.numSpeakers) config.num_speakers = options.numSpeakers;
    if (options.speakerNames) config.speaker_names = options.speakerNames;
    if (Object.keys(config).length > 0) {
      ws.send(JSON.stringify(config));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      options.onMessage(data);
    } catch {
      // skip non-JSON messages
    }
  };

  ws.onerror = (event) => options.onError(event);
  ws.onclose = () => options.onClose();

  return {
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    close: () => ws.close(),
    ws,
  };
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch('/health');
    return response.ok;
  } catch {
    return false;
  }
}
