
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ApiKeyStore {
  keys: {
    openai: string;
    anthropic: string;
  };
  setKey: (provider: keyof ApiKeyStore["keys"], key: string) => void;
}

export const useApiKeys = create<ApiKeyStore>()(
  persist(
    (set) => ({
      keys: {
        openai: import.meta.env.VITE_OPENAI_API_KEY || "",
        anthropic: import.meta.env.VITE_ANTHROPIC_API_KEY || "",
      },
      setKey: (provider, key) =>
        set((state) => ({
          keys: { ...state.keys, [provider]: key },
        })),
    }),
    {
      name: "llm-api-keys",
    }
  )
);
