import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Prompt } from '@/types';

interface PromptState {
  prompts: Prompt[];
  addPrompt: (prompt: Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updatePrompt: (id: string, updates: Partial<Omit<Prompt, 'id' | 'createdAt'>>) => void;
  deletePrompt: (id: string) => void;
  copyPrompt: (id: string) => void;
  importPrompts: (prompts: Prompt[]) => void;
  searchPrompts: (query: string) => Prompt[];
  getPromptsByTag: (tag: string) => Prompt[];
  getAllTags: () => string[];
}

export const usePromptStore = create<PromptState>()(
  persist(
    (set, get) => ({
      prompts: [
        {
          id: 'default-correction',
          name: 'Korrektur',
          content:
            'Korrigiere den folgenden medizinischen Transkriptionstext. Berichtige Rechtschreibung, Grammatik und medizinische Fachbegriffe. Behalte den Inhalt bei:\n\n{text}',
          tags: ['korrektur', 'standard'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'default-summary',
          name: 'Zusammenfassung',
          content:
            'Fasse den folgenden medizinischen Text zusammen. Erstelle eine strukturierte Zusammenfassung mit Diagnose, Befund und Therapie:\n\n{text}',
          tags: ['zusammenfassung', 'standard'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'default-letter',
          name: 'Arztbrief',
          content:
            'Erstelle einen Arztbrief basierend auf dem folgenden Transkript. Verwende die übliche Struktur (Anrede, Diagnose, Anamnese, Befund, Therapie, Empfehlung):\n\n{text}',
          tags: ['arztbrief', 'standard'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      addPrompt: (prompt) =>
        set((state) => ({
          prompts: [
            ...state.prompts,
            {
              ...prompt,
              id: uuidv4(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        })),
      updatePrompt: (id, updates) =>
        set((state) => ({
          prompts: state.prompts.map((p) =>
            p.id === id
              ? { ...p, ...updates, updatedAt: new Date().toISOString() }
              : p
          ),
        })),
      deletePrompt: (id) =>
        set((state) => ({
          prompts: state.prompts.filter((p) => p.id !== id),
        })),
      copyPrompt: (id) => {
        const prompt = get().prompts.find((p) => p.id === id);
        if (prompt) {
          set((state) => ({
            prompts: [
              ...state.prompts,
              {
                ...prompt,
                id: uuidv4(),
                name: `${prompt.name} (Kopie)`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          }));
        }
      },
      importPrompts: (prompts) =>
        set((state) => {
          const existingIds = new Set(state.prompts.map((p) => p.id));
          const newPrompts = prompts
            .filter((p) => !existingIds.has(p.id))
            .map((p) => ({ ...p, id: p.id || uuidv4() }));
          return { prompts: [...state.prompts, ...newPrompts] };
        }),
      searchPrompts: (query) => {
        const q = query.toLowerCase();
        return get().prompts.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q))
        );
      },
      getPromptsByTag: (tag) =>
        get().prompts.filter((p) => p.tags.includes(tag)),
      getAllTags: () => {
        const tags = new Set<string>();
        get().prompts.forEach((p) => p.tags.forEach((t) => tags.add(t)));
        return Array.from(tags).sort();
      },
    }),
    { name: 'parakeet-prompts' }
  )
);
