import type { Recording, TranscriptionResult } from '@/types';

export interface StorageBackend {
  saveRecording(recording: Recording): Promise<void>;
  loadRecordings(): Promise<Recording[]>;
  deleteRecording(id: string): Promise<void>;
}

class LocalStorageBackend implements StorageBackend {
  private readonly KEY = 'parakeet-recordings-data';

  async saveRecording(recording: Recording): Promise<void> {
    const existing = await this.loadMeta();
    const meta = {
      id: recording.id,
      name: recording.name,
      patientId: recording.patientId,
      duration: recording.duration,
      createdAt: recording.createdAt,
      transcription: recording.transcription,
    };
    existing.push(meta);
    localStorage.setItem(this.KEY, JSON.stringify(existing));
  }

  async loadRecordings(): Promise<Recording[]> {
    return this.loadMeta().map((m) => ({
      ...m,
      duration: m.duration || 0,
    }));
  }

  async deleteRecording(id: string): Promise<void> {
    const existing = await this.loadMeta();
    const filtered = existing.filter((r) => r.id !== id);
    localStorage.setItem(this.KEY, JSON.stringify(filtered));
  }

  private loadMeta(): Array<{
    id: string;
    name: string;
    patientId?: string;
    duration: number;
    createdAt: string;
    transcription?: TranscriptionResult;
  }> {
    const data = localStorage.getItem(this.KEY);
    return data ? JSON.parse(data) : [];
  }
}

class RestStorageBackend implements StorageBackend {
  private baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async saveRecording(recording: Recording): Promise<void> {
    const formData = new FormData();
    formData.append('id', recording.id);
    formData.append('name', recording.name);
    formData.append('duration', String(recording.duration));
    formData.append('createdAt', recording.createdAt);
    if (recording.patientId) formData.append('patientId', recording.patientId);
    if (recording.blob) formData.append('audio', recording.blob);
    if (recording.transcription) {
      formData.append('transcription', JSON.stringify(recording.transcription));
    }

    const response = await fetch(`${this.baseUrl}/recordings`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) throw new Error('Failed to save recording');
  }

  async loadRecordings(): Promise<Recording[]> {
    const response = await fetch(`${this.baseUrl}/recordings`);
    if (!response.ok) throw new Error('Failed to load recordings');
    return response.json();
  }

  async deleteRecording(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/recordings/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete recording');
  }
}

export function createStorageBackend(
  mode: 'local' | 'rest',
  restUrl?: string
): StorageBackend {
  if (mode === 'rest' && restUrl) {
    return new RestStorageBackend(restUrl);
  }
  return new LocalStorageBackend();
}
