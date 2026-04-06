import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Patient } from '@/types';

interface PatientState {
  patients: Patient[];
  selectedPatientId: string | null;
  addPatient: (patient: Omit<Patient, 'id'> & { id?: string }) => void;
  updatePatient: (id: string, updates: Partial<Patient>) => void;
  deletePatient: (id: string) => void;
  selectPatient: (id: string | null) => void;
  importPatients: (patients: Patient[]) => void;
  getSelectedPatient: () => Patient | undefined;
}

export const usePatientStore = create<PatientState>()(
  persist(
    (set, get) => ({
      patients: [],
      selectedPatientId: null,
      addPatient: (patient) =>
        set((state) => ({
          patients: [
            ...state.patients,
            { id: patient.id || uuidv4(), name: patient.name, vorname: patient.vorname },
          ],
        })),
      updatePatient: (id, updates) =>
        set((state) => ({
          patients: state.patients.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),
      deletePatient: (id) =>
        set((state) => ({
          patients: state.patients.filter((p) => p.id !== id),
          selectedPatientId:
            state.selectedPatientId === id ? null : state.selectedPatientId,
        })),
      selectPatient: (id) => set({ selectedPatientId: id }),
      importPatients: (patients) =>
        set((state) => {
          const existingIds = new Set(state.patients.map((p) => p.id));
          const newPatients = patients.filter((p) => !existingIds.has(p.id));
          return { patients: [...state.patients, ...newPatients] };
        }),
      getSelectedPatient: () => {
        const state = get();
        return state.patients.find((p) => p.id === state.selectedPatientId);
      },
    }),
    { name: 'parakeet-patients' }
  )
);
