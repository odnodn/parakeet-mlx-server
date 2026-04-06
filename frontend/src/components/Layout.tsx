import { useState, useCallback } from 'react';
import {
  Mic,
  Users,
  FileAudio,
  MessageSquare,
  Bot,
  Stethoscope,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AudioRecorder } from '@/components/AudioRecorder';
import { AudioPlayer } from '@/components/AudioPlayer';
import { TranscriptionView } from '@/components/TranscriptionView';
import { PatientManager } from '@/components/PatientManager';
import { RecordingList } from '@/components/RecordingList';
import { PromptManager } from '@/components/PromptManager';
import { AiAssistant } from '@/components/AiAssistant';
import { MedicalTerms } from '@/components/MedicalTerms';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRecordingStore } from '@/stores/recordingStore';
import { usePatientStore } from '@/stores/patientStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranscription } from '@/hooks/useTranscription';
import { getAudioDuration } from '@/services/audioService';

type Section =
  | 'recording'
  | 'patients'
  | 'recordings'
  | 'prompts'
  | 'ai'
  | 'terms'
  | 'settings';

const NAV_ITEMS: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'recording', label: 'Aufnahme', icon: Mic },
  { id: 'patients', label: 'Patienten', icon: Users },
  { id: 'recordings', label: 'Aufnahmen', icon: FileAudio },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'ai', label: 'KI-Assistent', icon: Bot },
  { id: 'terms', label: 'Fachbegriffe', icon: Stethoscope },
  { id: 'settings', label: 'Einstellungen', icon: Settings },
];

export function Layout() {
  const [activeSection, setActiveSection] = useState<Section>('recording');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | undefined>(undefined);

  const { addRecording, getRecording, getBlob, setTranscription } = useRecordingStore();
  const { getSelectedPatient } = usePatientStore();
  const { settings } = useSettingsStore();
  const { isTranscribing, result, streamText, transcribe, transcribeWithStream, reset } =
    useTranscription();

  const selectedRecording = selectedRecordingId
    ? getRecording(selectedRecordingId)
    : null;

  const transcriptText =
    selectedRecording?.transcription?.text || result?.text || streamText || '';

  const handleRecordingComplete = useCallback(
    async (blob: Blob) => {
      setCurrentBlob(blob);
      setTrimStart(0);
      setTrimEnd(undefined);

      const patient = getSelectedPatient();
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = String(now.getFullYear()).slice(2);

      let name = `Aufnahme_${dd}${mm}${yy}`;
      if (patient) {
        name = `${dd}${mm}${yy}-1_${patient.name}_${patient.vorname}`;
      }

      let duration = 0;
      try {
        duration = await getAudioDuration(blob);
      } catch {
        // fallback
      }

      const id = addRecording({
        name,
        patientId: patient?.id,
        blob,
        duration,
        createdAt: now.toISOString(),
      });
      setSelectedRecordingId(id);

      // Auto-transcribe
      reset();
      try {
        const transcriptionResult =
          settings.streamingMode === 'http'
            ? await transcribe(blob, {
                diarize: settings.diarize,
                numSpeakers: settings.numSpeakers,
                speakerNames: settings.speakerNames,
              })
            : await transcribeWithStream(blob, {
                chunkDuration: settings.chunkDuration,
              });
        setTranscription(id, transcriptionResult);
      } catch {
        // Error handled in hook
      }
    },
    [
      getSelectedPatient,
      addRecording,
      settings,
      transcribe,
      transcribeWithStream,
      setTranscription,
      reset,
    ],
  );

  const handleSelectRecording = useCallback(
    (id: string) => {
      setSelectedRecordingId(id);
      const blob = getBlob(id);
      if (blob) {
        setCurrentBlob(blob);
      } else {
        setCurrentBlob(null);
      }
      setTrimStart(0);
      setTrimEnd(undefined);
      reset();
    },
    [getBlob, reset],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r bg-card transition-all duration-200',
          sidebarCollapsed ? 'w-16' : 'w-52',
        )}
      >
        {/* Logo area */}
        <div
          className="flex h-14 items-center justify-center border-b px-4 cursor-pointer"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <Mic className="h-6 w-6 text-primary" />
          ) : (
            <span className="text-lg font-bold tracking-tight">Parakeet</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  sidebarCollapsed && 'justify-center px-2',
                )}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <div className="flex h-14 items-center border-b px-6">
          <h1 className="text-lg font-semibold">
            {NAV_ITEMS.find((i) => i.id === activeSection)?.label}
          </h1>
        </div>

        <ScrollArea className="h-[calc(100vh-3.5rem)]">
          <div className="mx-auto max-w-5xl p-6">
            {activeSection === 'recording' && (
              <div className="space-y-4">
                <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                <AudioPlayer
                  blob={currentBlob}
                  trimStart={trimStart}
                  trimEnd={trimEnd}
                  onTrimStartChange={setTrimStart}
                  onTrimEndChange={setTrimEnd}
                />
                <TranscriptionView
                  result={selectedRecording?.transcription || result}
                  streamText={streamText}
                  isTranscribing={isTranscribing}
                />
              </div>
            )}

            {activeSection === 'patients' && <PatientManager />}

            {activeSection === 'recordings' && (
              <div className="space-y-4">
                <RecordingList
                  selectedRecordingId={selectedRecordingId}
                  onSelectRecording={handleSelectRecording}
                />
                {selectedRecording?.transcription && (
                  <TranscriptionView result={selectedRecording.transcription} />
                )}
              </div>
            )}

            {activeSection === 'prompts' && <PromptManager />}

            {activeSection === 'ai' && <AiAssistant transcriptText={transcriptText} />}

            {activeSection === 'terms' && <MedicalTerms />}

            {activeSection === 'settings' && <SettingsPanel />}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
