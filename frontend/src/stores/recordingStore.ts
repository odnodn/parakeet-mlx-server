import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Recording, TranscriptionResult } from '@/types';

interface RecordingMeta {
  id: string;
  name: string;
  patientId?: string;
  duration: number;
  createdAt: string;
  transcription?: TranscriptionResult;
  trimStart?: number;
  trimEnd?: number;
}

interface RecordingState {
  recordings: RecordingMeta[];
  blobMap: Map<string, Blob>;
  addRecording: (recording: Omit<Recording, 'id'> & { id?: string }) => string;
  updateRecording: (id: string, updates: Partial<RecordingMeta>) => void;
  deleteRecording: (id: string) => void;
  setTranscription: (id: string, transcription: TranscriptionResult) => void;
  getRecording: (id: string) => RecordingMeta | undefined;
  getBlob: (id: string) => Blob | undefined;
  getRecordingsForPatient: (patientId: string) => RecordingMeta[];
}

export const useRecordingStore = create<RecordingState>()(
  persist(
    (set, get) => ({
      recordings: [],
      blobMap: new Map(),
      addRecording: (recording) => {
        const id = recording.id || uuidv4();
        const meta: RecordingMeta = {
          id,
          name: recording.name,
          patientId: recording.patientId,
          duration: recording.duration,
          createdAt: recording.createdAt,
          transcription: recording.transcription,
          trimStart: recording.trimStart,
          trimEnd: recording.trimEnd,
        };
        set((state) => {
          if (recording.blob) {
            state.blobMap.set(id, recording.blob);
          }
          return { recordings: [...state.recordings, meta] };
        });
        return id;
      },
      updateRecording: (id, updates) =>
        set((state) => ({
          recordings: state.recordings.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        })),
      deleteRecording: (id) =>
        set((state) => {
          state.blobMap.delete(id);
          return { recordings: state.recordings.filter((r) => r.id !== id) };
        }),
      setTranscription: (id, transcription) =>
        set((state) => ({
          recordings: state.recordings.map((r) =>
            r.id === id ? { ...r, transcription } : r
          ),
        })),
      getRecording: (id) => get().recordings.find((r) => r.id === id),
      getBlob: (id) => get().blobMap.get(id),
      getRecordingsForPatient: (patientId) =>
        get().recordings.filter((r) => r.patientId === patientId),
    }),
    {
      name: 'parakeet-recordings',
      partialize: (state) => ({
        recordings: state.recordings,
      }),
    }
  )
);
