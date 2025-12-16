'use client';

import { createContext, useContext, useState } from 'react';
import type { MockVariant } from '@/mock/userMap';

type VariantContextValue = {
  variant: MockVariant;
  setVariant: (next: MockVariant) => void;
};

const VariantContext = createContext<VariantContextValue | undefined>(undefined);

export const VariantProvider = ({ children }: { children: React.ReactNode }) => {
  const [variant, setVariant] = useState<MockVariant>('normal');

  return <VariantContext.Provider value={{ variant, setVariant }}>{children}</VariantContext.Provider>;
};

export const useVariant = () => {
  const ctx = useContext(VariantContext);
  if (!ctx) {
    throw new Error('useVariant must be used within VariantProvider');
  }
  return ctx;
};
