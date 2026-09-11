import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  AiExamplesOut,
  AiExplainOut,
  AiMnemonicOut,
  AiPracticeOut,
  DictionarySearchOut,
  VocabNoteOut,
  VocabWordDetailOut,
  VocabWordOut,
  VocabWordSaveOut,
} from '@/types/api';

interface VocabularyState {
  words: VocabWordOut[];
  wordsStatus: 'idle' | 'loading' | 'error';
  wordsError: string | null;

  selectedDetail: VocabWordDetailOut | null;
  detailStatus: 'idle' | 'loading' | 'error';
  detailError: string | null;

  searchResult: DictionarySearchOut | null;
  searchStatus: 'idle' | 'loading' | 'not-found' | 'error';
  searchError: string | null;

  fetchWords: () => Promise<void>;
  fetchWordDetail: (word: string) => Promise<void>;
  saveWord: (payload: {
    word: string;
    sentence?: string;
    bookId?: string;
    blockIndex?: number;
  }) => Promise<{ alreadySaved: boolean }>;
  addNote: (text: string) => Promise<void>;
  deleteNote: (noteId: string) => Promise<void>;
  addTag: (tag: string) => Promise<void>;
  removeTag: (tag: string) => Promise<void>;
  deleteWord: (vocabWordId: string) => Promise<void>;
  searchDictionary: (word: string) => Promise<void>;
  clearSearch: () => void;
  saveManualWord: (payload: {
    word: string;
    pos: string;
    definition: string;
    example?: string;
    synonyms?: string[];
    ipa?: string;
    audioUrl?: string;
    note?: string;
  }) => Promise<{ alreadySaved: boolean }>;

  // AI-powered additions — all real local-LLM calls (see backend/vocabulary_ai.py),
  // gated the same way Conversation gates AI use (throws with a "Launch AI"
  // message when the model isn't downloaded/loaded).
  aiExplain: (word: string, context: string) => Promise<AiExplainOut>;
  fetchAiExamples: (vocabWordId: string, count?: number) => Promise<string[]>;
  generateMnemonic: (vocabWordId: string) => Promise<string>;
  fetchAiPractice: (vocabWordId: string) => Promise<string>;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot load or save vocabulary yet');
  return id;
}

export const useVocabularyStore = create<VocabularyState>((set, get) => ({
  words: [],
  wordsStatus: 'idle',
  wordsError: null,

  selectedDetail: null,
  detailStatus: 'idle',
  detailError: null,

  searchResult: null,
  searchStatus: 'idle',
  searchError: null,

  fetchWords: async () => {
    set({ wordsStatus: 'loading', wordsError: null });
    try {
      const userId = requireUserId();
      const words = await api.get<VocabWordOut[]>(`/vocabulary?user_id=${encodeURIComponent(userId)}`);
      set({ words, wordsStatus: 'idle' });
    } catch (err) {
      set({ wordsStatus: 'error', wordsError: err instanceof Error ? err.message : String(err) });
    }
  },

  fetchWordDetail: async (word) => {
    set({ detailStatus: 'loading', detailError: null, selectedDetail: null });
    try {
      const userId = requireUserId();
      const detail = await api.get<VocabWordDetailOut>(
        `/vocabulary/by-word/${encodeURIComponent(word)}?user_id=${encodeURIComponent(userId)}`,
      );
      set({ selectedDetail: detail, detailStatus: 'idle' });
    } catch (err) {
      // A 404 here is a real, expected outcome — selectedWord can point at a
      // word from Dashboard's separate mock "Recent words" list that was
      // never actually saved, not just a network failure.
      set({ detailStatus: 'error', detailError: err instanceof Error ? err.message : String(err) });
    }
  },

  saveWord: async ({ word, sentence, bookId, blockIndex }) => {
    const userId = requireUserId();
    const result = await api.post<VocabWordSaveOut>('/vocabulary', {
      user_id: userId,
      word,
      sentence: sentence ?? null,
      book_id: bookId ?? null,
      block_index: blockIndex ?? null,
    });

    set((s) => {
      const existingIndex = s.words.findIndex((w) => w.id === result.word.id);
      const words =
        existingIndex >= 0
          ? s.words.map((w, i) => (i === existingIndex ? result.word : w))
          : [result.word, ...s.words];
      const selectedDetail =
        s.selectedDetail?.id === result.word.id ? { ...s.selectedDetail, ...result.word } : s.selectedDetail;
      return { words, selectedDetail };
    });

    return { alreadySaved: result.already_saved };
  },

  addNote: async (text) => {
    const detail = get().selectedDetail;
    if (!detail) return;
    const userId = requireUserId();
    const note = await api.post<VocabNoteOut>(
      `/vocabulary/${detail.id}/notes?user_id=${encodeURIComponent(userId)}`,
      { text },
    );
    set((s) => (s.selectedDetail ? { selectedDetail: { ...s.selectedDetail, notes: [...s.selectedDetail.notes, note] } } : {}));
  },

  deleteNote: async (noteId) => {
    const detail = get().selectedDetail;
    if (!detail) return;
    const userId = requireUserId();
    await api.delete(`/vocabulary/${detail.id}/notes/${noteId}?user_id=${encodeURIComponent(userId)}`);
    set((s) =>
      s.selectedDetail
        ? { selectedDetail: { ...s.selectedDetail, notes: s.selectedDetail.notes.filter((n) => n.id !== noteId) } }
        : {},
    );
  },

  addTag: async (tag) => {
    const detail = get().selectedDetail;
    if (!detail) return;
    const userId = requireUserId();
    const tags = await api.post<string[]>(`/vocabulary/${detail.id}/tags?user_id=${encodeURIComponent(userId)}`, {
      tag,
    });
    set((s) => {
      if (!s.selectedDetail) return {};
      const selectedDetail = { ...s.selectedDetail, tags };
      return { selectedDetail, words: s.words.map((w) => (w.id === detail.id ? { ...w, tags } : w)) };
    });
  },

  removeTag: async (tag) => {
    const detail = get().selectedDetail;
    if (!detail) return;
    const userId = requireUserId();
    const tags = await api.delete<string[]>(
      `/vocabulary/${detail.id}/tags/${encodeURIComponent(tag)}?user_id=${encodeURIComponent(userId)}`,
    );
    set((s) => {
      if (!s.selectedDetail) return {};
      const selectedDetail = { ...s.selectedDetail, tags };
      return { selectedDetail, words: s.words.map((w) => (w.id === detail.id ? { ...w, tags } : w)) };
    });
  },

  deleteWord: async (vocabWordId) => {
    const userId = requireUserId();
    await api.delete(`/vocabulary/${vocabWordId}?user_id=${encodeURIComponent(userId)}`);
    set((s) => ({
      words: s.words.filter((w) => w.id !== vocabWordId),
      selectedDetail: s.selectedDetail?.id === vocabWordId ? null : s.selectedDetail,
    }));
  },

  searchDictionary: async (word) => {
    const clean = word.trim();
    if (!clean) return;
    set({ searchStatus: 'loading', searchError: null, searchResult: null });
    try {
      const result = await api.get<DictionarySearchOut>(`/vocabulary/dictionary-search?w=${encodeURIComponent(clean)}`);
      set({ searchResult: result, searchStatus: result.found ? 'idle' : 'not-found' });
    } catch (err) {
      set({ searchStatus: 'error', searchError: err instanceof Error ? err.message : String(err) });
    }
  },

  clearSearch: () => set({ searchResult: null, searchStatus: 'idle', searchError: null }),

  saveManualWord: async ({ word, pos, definition, example, synonyms, ipa, audioUrl, note }) => {
    const userId = requireUserId();
    const result = await api.post<VocabWordSaveOut>('/vocabulary/manual', {
      user_id: userId,
      word,
      pos,
      definition,
      example: example ?? null,
      synonyms: synonyms ?? [],
      ipa: ipa ?? null,
      audio_url: audioUrl ?? null,
      note: note ?? null,
    });

    set((s) => {
      const existingIndex = s.words.findIndex((w) => w.id === result.word.id);
      const words =
        existingIndex >= 0
          ? s.words.map((w, i) => (i === existingIndex ? result.word : w))
          : [result.word, ...s.words];
      return { words };
    });

    return { alreadySaved: result.already_saved };
  },

  aiExplain: async (word, context) => {
    const userId = requireUserId();
    return api.post<AiExplainOut>('/vocabulary/ai-explain', { user_id: userId, word, context });
  },

  fetchAiExamples: async (vocabWordId, count) => {
    const userId = requireUserId();
    const qs = `user_id=${encodeURIComponent(userId)}${count ? `&count=${count}` : ''}`;
    const result = await api.post<AiExamplesOut>(`/vocabulary/${vocabWordId}/ai-examples?${qs}`);
    return result.examples;
  },

  generateMnemonic: async (vocabWordId) => {
    const userId = requireUserId();
    const result = await api.post<AiMnemonicOut>(
      `/vocabulary/${vocabWordId}/ai-mnemonic?user_id=${encodeURIComponent(userId)}`,
    );
    set((s) => {
      if (!s.selectedDetail || s.selectedDetail.id !== vocabWordId) return {};
      return { selectedDetail: { ...s.selectedDetail, ai_mnemonic: result.mnemonic } };
    });
    return result.mnemonic;
  },

  fetchAiPractice: async (vocabWordId) => {
    const userId = requireUserId();
    const result = await api.post<AiPracticeOut>(
      `/vocabulary/${vocabWordId}/ai-practice?user_id=${encodeURIComponent(userId)}`,
    );
    return result.question;
  },
}));
