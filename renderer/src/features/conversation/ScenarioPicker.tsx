import { useEffect, useState } from 'react';
import { useConversationStore } from '@/store/conversationStore';
import type { CustomScenarioIn, CustomScenarioOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

/** What was picked: a catalog scene, or one of the learner's own. `id` is
 * what the picker marks as starting. */
export interface ScenarioChoice {
  id: string;
  scenario: string;
  customScenarioId?: string;
  label: string;
}

const MINE = 'mine';

const EMPTY: CustomScenarioIn = {
  title: '',
  ai_name: '',
  ai_role: '',
  personality: '',
  setting: '',
  learner_role: '',
  goal: '',
};

/** The fields of a learner-written scene, each with what it is for. The
 * three required ones are enough for a scene; the rest sharpen it. */
const FIELDS: Array<{ key: keyof CustomScenarioIn; label: string; hint: string; required?: boolean; long?: boolean }> = [
  { key: 'title', label: 'Title', hint: 'Renting a flat', required: true },
  { key: 'ai_role', label: 'Who the AI plays', hint: 'a landlord showing a flat to rent', required: true },
  {
    key: 'setting',
    label: 'The situation',
    hint: 'A small one-bedroom flat near the station. The rent is a bit high and the heating is old.',
    required: true,
    long: true,
  },
  { key: 'learner_role', label: 'Who you are', hint: 'someone looking for a flat' },
  { key: 'goal', label: 'The goal', hint: 'Ask about rent, bills and the contract, then decide.' },
  { key: 'ai_name', label: "The AI's name", hint: 'Mr. Okafor' },
  { key: 'personality', label: 'Personality', hint: 'Friendly but a hard bargainer; talks fast.' },
];

export function ScenarioPicker({
  onStart,
  starting,
  warmingUp,
}: {
  onStart: (choice: ScenarioChoice) => void;
  /** The id of the choice being started, if any. */
  starting: string | null;
  warmingUp: boolean;
}) {
  const catalog = useConversationStore((s) => s.catalog);
  const fetchCatalog = useConversationStore((s) => s.fetchCatalog);
  const createCustomScenario = useConversationStore((s) => s.createCustomScenario);
  const deleteCustomScenario = useConversationStore((s) => s.deleteCustomScenario);

  const [tab, setTab] = useState('everyday');
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState<CustomScenarioIn>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalog().catch((err) => setLoadError(friendlyMessage(err, 'Loading the scenarios')));
  }, [fetchCatalog]);

  if (loadError) return <div className="font-mono text-[10.5px] text-[#c0563f]">{loadError}</div>;
  if (!catalog) return <div className="font-mono text-[10.5px] text-tx3">loading scenarios…</div>;

  const busy = starting !== null;
  const category = catalog.categories.find((c) => c.key === tab);
  const canSave = Boolean(draft.title.trim() && draft.ai_role.trim() && draft.setting.trim());

  const save = async (andStart: boolean) => {
    if (!canSave || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const made = await createCustomScenario(draft);
      setDraft(EMPTY);
      setWriting(false);
      if (andStart) onStart(customChoice(made));
    } catch (err) {
      setFormError(friendlyMessage(err, 'Saving your scenario'));
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    ...catalog.categories.map((c) => ({ key: c.key, label: c.label })),
    { key: MINE, label: `My scenarios${catalog.custom.length ? ` · ${catalog.custom.length}` : ''}` },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-[5px]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="rounded-full border px-[11px] py-[5px] font-sans text-[11px] font-medium"
            style={{
              borderColor: tab === t.key ? 'var(--accLine)' : 'var(--line2)',
              background: tab === t.key ? 'var(--accSoft)' : 'transparent',
              color: tab === t.key ? 'var(--acc)' : 'var(--tx2)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-[10px] font-sans text-[11.5px] leading-[1.6] text-tx3">
        {tab === MINE
          ? 'Scenes you write yourself. The AI stays in the role you give it, speaks at your level, and works in your target words.'
          : category?.description}
      </div>

      <div className="mt-[12px] grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[8px]">
        {tab !== MINE &&
          category?.scenarios.map((s) => (
            <SceneCard
              key={s.key}
              title={s.label}
              meta={`~${s.minutes} m · ${s.level}+`}
              summary={s.summary}
              who={`with ${s.persona_name}, ${s.persona_role}`}
              you={s.learner_role === 'themselves' ? undefined : `you: ${s.learner_role}`}
              disabled={busy}
              state={starting === s.key ? (warmingUp ? 'warming up the model…' : 'starting…') : null}
              onClick={() => onStart({ id: s.key, scenario: s.key, label: s.label })}
            />
          ))}

        {tab === MINE &&
          catalog.custom.map((c) => (
            <SceneCard
              key={c.id}
              title={c.title}
              meta="your scene"
              summary={c.setting}
              who={`with ${c.ai_name || 'the AI'}, ${c.ai_role}`}
              you={c.learner_role ? `you: ${c.learner_role}` : undefined}
              disabled={busy}
              state={starting === c.id ? (warmingUp ? 'warming up the model…' : 'starting…') : null}
              onClick={() => onStart(customChoice(c))}
              onDelete={() => void deleteCustomScenario(c.id)}
            />
          ))}

        {tab === MINE && !writing && (
          <button
            onClick={() => setWriting(true)}
            className="grid min-h-[112px] place-items-center rounded-field border border-dashed border-line2 font-sans text-[12px] text-tx2 hover:border-acc hover:text-acc"
          >
            ＋ Write your own scenario
          </button>
        )}
      </div>

      {tab === MINE && writing && (
        <div className="mt-[12px] rounded-field border border-line2 bg-panel p-[14px]">
          <div className="grid grid-cols-2 gap-x-[12px] gap-y-[10px]">
            {FIELDS.map((f) => (
              <label key={f.key} className={f.long ? 'col-span-2' : ''}>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-tx3">
                  {f.label}
                  {f.required && <span className="text-acc"> *</span>}
                </span>
                {f.long ? (
                  <textarea
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    placeholder={f.hint}
                    rows={2}
                    maxLength={400}
                    className="mt-[4px] w-full resize-none rounded-field border border-line2 bg-transparent px-[9px] py-[7px] font-sans text-[12px] text-tx outline-none focus:border-acc"
                  />
                ) : (
                  <input
                    value={draft[f.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    placeholder={f.hint}
                    maxLength={400}
                    className="mt-[4px] w-full rounded-field border border-line2 bg-transparent px-[9px] py-[7px] font-sans text-[12px] text-tx outline-none focus:border-acc"
                  />
                )}
              </label>
            ))}
          </div>
          {formError && <div className="mt-[8px] font-mono text-[10.5px] text-[#c0563f]">{formError}</div>}
          <div className="mt-[12px] flex flex-wrap items-center justify-end gap-[8px]">
            <button
              onClick={() => {
                setWriting(false);
                setDraft(EMPTY);
                setFormError(null);
              }}
              className="font-mono text-[11px] text-tx3 hover:text-acc"
            >
              cancel
            </button>
            <button
              onClick={() => void save(false)}
              disabled={!canSave || saving}
              className="rounded-field border border-line px-[12px] py-[7px] font-sans text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
            >
              save
            </button>
            <button
              onClick={() => void save(true)}
              disabled={!canSave || saving || busy}
              className="rounded-field bg-accSolid px-[12px] py-[7px] font-sans text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'saving…' : 'save & start'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function customChoice(c: CustomScenarioOut): ScenarioChoice {
  return { id: c.id, scenario: 'custom', customScenarioId: c.id, label: c.title };
}

function SceneCard({
  title,
  meta,
  summary,
  who,
  you,
  disabled,
  state,
  onClick,
  onDelete,
}: {
  title: string;
  meta: string;
  summary: string;
  who: string;
  you?: string;
  disabled: boolean;
  state: string | null;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex h-full w-full flex-col rounded-field border border-line2 bg-panel px-[12px] py-[10px] text-left hover:border-acc disabled:opacity-60"
      >
        <span className="flex w-full items-baseline justify-between gap-2">
          <span className="font-sans text-[12.5px] font-semibold text-tx">{state ?? title}</span>
          <span className="flex-none font-mono text-[9.5px] text-tx3">{meta}</span>
        </span>
        <span className="mt-[4px] line-clamp-2 font-sans text-[11px] leading-[1.55] text-tx2">{summary}</span>
        <span className="mt-auto pt-[7px] font-mono text-[9.5px] leading-[1.5] text-tx3">
          {who}
          {you && (
            <>
              <br />
              {you}
            </>
          )}
        </span>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          title="Delete this scenario (conversations already held in it keep it)"
          className="absolute bottom-[6px] right-[6px] hidden rounded-[4px] px-[5px] font-mono text-[10px] text-tx3 hover:text-[#c0563f] group-hover:block"
        >
          ✕
        </button>
      )}
    </div>
  );
}
