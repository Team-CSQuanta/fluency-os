import { useEffect, useState } from 'react';
import { Pill, Row, Section } from '@/features/settings/controls';
import { useSettingsStore } from '@/store/settingsStore';

function when(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** What leaves this machine, and what you can delete.
 *
 * The version of this page before it was a list of reassurances with no way
 * to check any of them. Each row here is either a fact the app can state
 * because of how it is built, or a real control — never a claim dressed as a
 * setting. The outbound row in particular reads the current configuration
 * rather than asserting "local", because with a cloud key set that would be
 * false.
 */
export function PrivacyPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const cache = useSettingsStore((s) => s.cache);
  const fetchCache = useSettingsStore((s) => s.fetchCache);
  const clearCache = useSettingsStore((s) => s.clearCache);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void fetchCache();
  }, [fetchCache]);

  const local = settings?.llm_mode === 'local';

  return (
    <>
      <Section
        title="What goes out, right now"
        note="Read from your current configuration rather than asserted — change the AI to a cloud provider and this changes with it."
      >
        <Row
          label="Telemetry"
          sub="There is no analytics code in the app. This is not a switch that happens to be off; there is nothing to switch."
          control={<Pill tone="ok">none, ever</Pill>}
        />
        <Row
          label="Conversation and explanations"
          sub={
            local
              ? 'A model on this machine answers them, so nothing goes out.'
              : `Sent to ${settings?.api_provider ?? 'your API provider'} — the words, not the audio. A local model keeps them here.`
          }
          control={<Pill tone={local ? 'ok' : 'warn'}>{local ? 'on this machine' : 'to the API'}</Pill>}
        />
        <Row
          label="Dictionary lookups"
          sub="A word the bundled lexicon and the local cache both lack is looked up online. The word alone is sent — never the sentence, the book or who you are."
          control={<Pill>the word only</Pill>}
        />
        <Row
          label="Challenge scenes"
          sub="Playing a VATEX scene contacts youtube-nocookie.com. Off unless you turned it on."
          control={
            <Pill tone={settings?.scene_embeds_enabled ? 'warn' : 'ok'}>
              {settings?.scene_embeds_enabled ? 'enabled' : 'off'}
            </Pill>
          }
        />
        <Row
          label="Model downloads"
          sub="Fetched from Hugging Face when you ask for one, and never again afterwards."
          control={<Pill>when you ask</Pill>}
        />
        <Row
          label="Your files, recordings and vocabulary"
          sub="Never uploaded anywhere, under any setting. Videos and books are read where you keep them and never copied."
          control={<Pill tone="ok">never</Pill>}
        />
      </Section>

      <Section
        title="The local dictionary cache"
        note="Every word an online dictionary has answered for on this machine, kept so a word is slow exactly once."
      >
        <Row
          label="Words cached"
          sub={cache ? `last added ${when(cache.last_cached_at)}` : 'reading…'}
          control={<Pill tone={cache && cache.entries > 0 ? 'ok' : 'muted'}>{cache?.entries ?? '…'}</Pill>}
        />
        <Row
          label="Clear it"
          sub="Nothing here was written by anyone and nothing is irreplaceable — it refills as you look words up. Words already in your vocabulary keep their own copy of the definition and are untouched."
          control={
            <button
              disabled={clearing || !cache || cache.entries === 0}
              onClick={async () => {
                setClearing(true);
                try {
                  await clearCache();
                } finally {
                  setClearing(false);
                }
              }}
              className="rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[10.5px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
            >
              {clearing ? 'clearing…' : 'clear cache'}
            </button>
          }
        />
      </Section>

      <Section title="Backup">
        <Row
          label="Your whole library"
          sub="The data folder in Account holds everything. Copying it is a complete backup, and putting it back is a complete restore."
          control={<Pill tone="ok">copy the folder</Pill>}
        />
      </Section>
    </>
  );
}
