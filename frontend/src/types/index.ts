export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
}

export interface SpeakerSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  recording_timestamp?: string;
  segments?: TranscriptionSegment[];
  speakers?: SpeakerSegment[];
  num_speakers?: number;
  speaker_labels?: string[];
}

export interface StreamChunk {
  chunk_index: number;
  text: string;
  is_final?: boolean;
  speakers?: SpeakerSegment[];
  num_speakers?: number;
}

export interface Patient {
  id: string;
  name: string;
  vorname: string;
}

export interface Recording {
  id: string;
  name: string;
  patientId?: string;
  blob?: Blob;
  url?: string;
  duration: number;
  createdAt: string;
  transcription?: TranscriptionResult;
  trimStart?: number;
  trimEnd?: number;
}

export interface Prompt {
  id: string;
  name: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MedicalTerm {
  id: string;
  term: string;
  category: string;
}

export type RecordingState = 'idle' | 'recording' | 'paused';
export type PlaybackState = 'idle' | 'playing' | 'paused';
export type TranscriptionMode = 'full' | 'realtime';
export type StreamingMode = 'http' | 'websocket';

export interface AppSettings {
  apiBaseUrl: string;
  openaiApiUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  streamingMode: StreamingMode;
  chunkDuration: number;
  diarize: boolean;
  numSpeakers: number;
  speakerNames: string;
  storageMode: 'local' | 'rest';
  restApiUrl: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: '/v1',
  openaiApiUrl: '',
  openaiApiKey: '',
  openaiModel: 'gpt-4',
  streamingMode: 'http',
  chunkDuration: 5,
  diarize: false,
  numSpeakers: 2,
  speakerNames: '',
  storageMode: 'local',
  restApiUrl: '',
};
