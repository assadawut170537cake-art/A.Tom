import { create } from 'zustand';

interface AgentPanelState {
  /** agent ที่เปิด panel อยู่บนหน้าหลัก (null = ปิด) */
  agentId: string | null;
  open: (agentId: string) => void;
  close: () => void;
}

/** สถานะ Agent Panel บนหน้าหลัก — ไม่ persist (เปิดแอปใหม่ = panel ปิด) */
export const useAgentPanelStore = create<AgentPanelState>()((set) => ({
  agentId: null,
  open: (agentId) => set({ agentId }),
  close: () => set({ agentId: null }),
}));
