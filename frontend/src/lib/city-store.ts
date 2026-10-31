'use client'

// Lựa chọn thành phố của người dùng (Task 63 — multi-city gate)
// - persist vào localStorage 'rideshift-city' → F5 giữ nguyên lựa chọn
// - null = chưa chọn → cổng chọn thành phố hiện trước khi vào màn hình chính

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type CityState = {
  cityId: string | null
  /** mở lại cổng chọn thành phố (nút "Đổi thành phố") */
  gateOpen: boolean
  selectCity: (id: string) => void
  openGate: () => void
  closeGate: () => void
}

export const useCityStore = create<CityState>()(
  persist(
    (set) => ({
      cityId: null,
      gateOpen: false,
      selectCity: (id) => set({ cityId: id, gateOpen: false }),
      openGate: () => set({ gateOpen: true }),
      closeGate: () => set({ gateOpen: false }),
    }),
    {
      name: 'rideshift-city',
      partialize: (s) => ({ cityId: s.cityId }),
    }
  )
)
