import { create } from 'zustand';
import { api, fetchBlobUrl } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  AiExamplesOut,
  AiEnrichOut,
  AiExplainOut,
  AiMnemonicOut,
  AiPracticeOut,
  DictionarySearchOut,
  VocabNoteOut,
  VocabOverviewOut,
  VocabSort,
  VocabStatusFilter,
  VocabWordDetailOut,
  VocabWordOut,
  VocabWordSaveOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

interface VocabularyState {
  words: VocabWordOut[];
  wordsStatus: 'idle' | 'loading' | 'error';
  wordsError: string | null;

  overview: VocabOverviewOut | null;

  // Browse state. Held here rather than in the component because every one
  // of these changes what the server is asked for, not how the result is
  // displayed.
  query: string;
  cefr: string | null;
  tag: string | null;
  statusFilter: VocabStatusFilter;
  sort: VocabSort;

  selectedDetail: VocabWordDetailOut | null;
  detailStatus: 'idle' | 'loading' | 'error';
  detailError: string | null;

  searchResult: DictionarySearchOut | null;
  searchStatus: 'idle' | 'loading' | 'not-found' | 'error';
  searchError: string | null;

  fetchWords: () => Promise<void>;
  pronunciationUrl: (vocabWordId: string, part: 'word' | 'sentence') => Promise<string>;
  fetchOverview: () => Promise<void>;
  setQuery: (query: string) => void;
  setStatusFilter: (status: VocabStatusFilter) => void;
  setSort: (sort: VocabSort) => void;
  setCefr: (cefr: string | null) => void;
  setTag: (tag: string | null) => void;
  clearFilters: () => void;
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
    aiDefinition?: string;
    aiExamples?: string[];
    aiMnemonic?: string;
    aiUsageNote?: string;
    aiSenseDefinition?: string;
  }) => Promise<{ alreadySaved: boolean }>;

  // AI-powered additions — all real local-LLM calls (see backend/vocabulary_ai.py),
  // gated the same way Conversation gates AI use (throws with a "Launch AI"
  // message when the model isn't downloaded/loaded).
  aiExplain: (word: string, context: string) => Promise<AiExplainOut>;
  aiEnrich: (word: string, opts?: { dictionaryDefinition?: string; context?: string }) => Promise<AiEnrichOut>;
  speakText: (text: string) => Promise<string>;
  fetchAiExamples: (vocabWordId: string, count?: number) => Promise<string[]>;
  generateMnemonic: (vocabWordId: string) => Promise<string>;
  fetchAiPractice: (vocabWordId: string) => Promise<string>;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot load or save vocabulary yet');
  return id;
}

// Bumped on every list request; a response with a stale token is discarded.
let lastWordsRequest = 0;

export const useVocabularyStore = create<VocabularyState>((set, get) => ({
  words: [],
  wordsStatus: 'idle',
  wordsError: null,

  overview: null,
  query: '',
  cefr: null,
  tag: null,
  statusFilter: 'all',
  sort: 'recent',

  selectedDetail: null,
  detailStatus: 'idle',
  detailError: null,

  searchResult: null,
  searchStatus: 'idle',
  searchError: null,

  fetchWords: async () => {
    const { query, cefr, tag, statusFilter, sort } = get();
    const userId = requireUserId();
    const params = new URLSearchParams({ user_id: userId, status_filter: statusFilter, sort });
    if (query.trim()) params.set('q', query.trim());
    if (cefr) params.set('cefr', cefr);
    if (tag) params.set('tag', tag);

    // Every request is tagged, and a response whose tag is no longer the
    // newest is dropped. Typing in the search box fires one request per
    // keystroke and they do not come back in order — without this the list
    // settles on whichever happened to be slowest, not what was typed.
    const token = ++lastWordsRequest;
    set({ wordsStatus: 'loading', wordsError: null });
    try {
      const words = await api.get<VocabWordOut[]>(`/vocabulary?${params.toString()}`);
      if (token !== lastWordsRequest) return;
      set({ words, wordsStatus: 'idle' });
    } catch (err) {
      if (token !== lastWordsRequest) return;
      set({ wordsStatus: 'error', wordsError: friendlyMessage(err, 'Loading your vocabulary') });
    }
  },

  pronunciationUrl: async (vocabWordId, part) => {
    // This request is also what synthesizes the clip, so the first call for a
    // word takes a moment and every one after it is served from disk.
    const userId = requireUserId();
    return fetchBlobUrl(
      `/vocabulary/${encodeURIComponent(vocabWordId)}/pronounce` +
        `?user_id=${encodeURIComponent(userId)}&part=${part}`,
    );
  },

  fetchOverview: async () => {
    try {
      const userId = requireUserId();
      const overview = await api.get<VocabOverviewOut>(
        `/vocabulary/overview?user_id=${encodeURIComponent(userId)}`,
      );
      set({ overview });
    } catch {
      // Counts are decoration — the list must still render without them.
    }
  },

  setQuery: (query) => {
    set({ query });
    void get().fetchWords();
  },
  setStatusFilter: (statusFilter) => {
    set({ statusFilter });
    void get().fetchWords();
  },
  setSort: (sort) => {
    set({ sort });
    void get().fetchWords();
  },
  setCefr: (cefr) => {
    set({ cefr });
    void get().fetchWords();
  },
  setTag: (tag) => {
    set({ tag });
    void get().fetchWords();
  },
  clearFilters: () => {
    set({ query: '', cefr: null, tag: null, statusFilter: 'all', sort: 'recent' });
    void get().fetchWords();
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
      set({ detailStatus: 'error', detailError: friendlyMessage(err, 'Opening this word') });
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
      set({ searchStatus: 'error', searchError: friendlyMessage(err, 'Looking that word up') });
    }
  },

  clearSearch: () => set({ searchResult: null, searchStatus: 'idle', searchError: null }),

  saveManualWord: async ({
    word, pos, definition, example, synonyms, ipa, audioUrl, note,
    aiDefinition, aiExamples, aiMnemonic, aiUsageNote, aiSenseDefinition,
  }) => {
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
      ai_definition: aiDefinition ?? null,
      ai_examples: aiExamples ?? [],
      ai_mnemonic: aiMnemonic ?? null,
      ai_usage_note: aiUsageNote ?? null,
      ai_sense_definition: aiSenseDefinition ?? null,
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

  aiEnrich: async (word, opts) => {
    const userId = requireUserId();
    return api.post<AiEnrichOut>('/vocabulary/ai-enrich', {
      user_id: userId,
      word,
      dictionary_definition: opts?.dictionaryDefinition,
      context: opts?.context,
    });
  },

  speakText: async (text) => {
    const userId = requireUserId();
    return fetchBlobUrl(
      `/vocabulary/speak?user_id=${encodeURIComponent(userId)}&text=${encodeURIComponent(text)}`,
    );
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
