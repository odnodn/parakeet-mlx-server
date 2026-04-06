import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { MedicalTerm } from '@/types';

interface MedicalTermsState {
  terms: MedicalTerm[];
  addTerm: (term: Omit<MedicalTerm, 'id'>) => void;
  deleteTerm: (id: string) => void;
  importTerms: (terms: MedicalTerm[]) => void;
  exportTerms: () => MedicalTerm[];
  getTermsByCategory: (category: string) => MedicalTerm[];
  getAllCategories: () => string[];
  getTermsText: () => string;
}

export const useMedicalTermsStore = create<MedicalTermsState>()(
  persist(
    (set, get) => ({
      terms: [],
      addTerm: (term) =>
        set((state) => ({
          terms: [...state.terms, { ...term, id: uuidv4() }],
        })),
      deleteTerm: (id) =>
        set((state) => ({
          terms: state.terms.filter((t) => t.id !== id),
        })),
      importTerms: (terms) =>
        set((state) => {
          const existingTerms = new Set(
            state.terms.map((t) => `${t.term}:${t.category}`)
          );
          const newTerms = terms
            .filter((t) => !existingTerms.has(`${t.term}:${t.category}`))
            .map((t) => ({ ...t, id: t.id || uuidv4() }));
          return { terms: [...state.terms, ...newTerms] };
        }),
      exportTerms: () => get().terms,
      getTermsByCategory: (category) =>
        get().terms.filter((t) => t.category === category),
      getAllCategories: () => {
        const cats = new Set<string>();
        get().terms.forEach((t) => cats.add(t.category));
        return Array.from(cats).sort();
      },
      getTermsText: () =>
        get()
          .terms.map((t) => t.term)
          .join(', '),
    }),
    { name: 'parakeet-medical-terms' }
  )
);
