import { useEffect } from 'react';
import { Row, Section, Segmented, Slider, Toggle } from '@/features/settings/controls';
import { useReaderStore } from '@/store/readerStore';
import type { PageTheme } from '@/types/api';

const THEMES: Array<{ value: PageTheme; label: string; title: string }> = [
  { value: 'auto', label: 'auto', title: 'Follows the app theme.' },
  { value: 'light', label: 'paper', title: 'Near-white, like a printed page.' },
  { value: 'sepia', label: 'sepia', title: 'Warm and low-contrast, for long sittings.' },
  { value: 'dark', label: 'dark', title: 'Light text on a dark page.' },
];

/** Reader defaults. The same controls sit in the reader's own side panel —
 * this is the copy you can find without a book already open. */
export function ReadingPanel() {
  const prefs = useReaderStore((s) => s.prefs);
  const setPrefs = useReaderStore((s) => s.setPrefs);
  const loadPrefs = useReaderStore((s) => s.loadPrefs);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  return (
    <>
      <Section title="The page">
        <Row
          label="Text size"
          sub="the book's text only — the interface around it is set in Appearance"
          stacked
          control={
            <Slider
              label="Reader text size"
              value={prefs.font_size}
              min={12}
              max={26}
              step={0.5}
              onCommit={(v) => setPrefs({ font_size: v })}
              format={(v) => `${v.toFixed(1)} px`}
            />
          }
        />
        <Row
          label="Page theme"
          sub="independent of the app's theme, because a book is read for longer than a menu"
          control={
            <Segmented value={prefs.page_theme} options={THEMES} onChange={(v) => setPrefs({ page_theme: v })} />
          }
        />
      </Section>

      <Section
        title="What the reader marks up"
        note="Both are off in the sense that they never change the text — they only add something over it."
      >
        <Row
          label="Difficulty heat"
          sub="Tints the words rated above your level, so the hard ones are visible before you hit them. Clicking a tinted word looks it up."
          control={
            <Toggle
              label="Difficulty heat"
              checked={prefs.heat_on}
              onChange={(v) => setPrefs({ heat_on: v })}
            />
          }
        />
        <Row
          label="Show the printed page"
          sub="For PDFs: the publisher's own typeset page beside the extracted text, so figures, tables and equations are not lost to the extractor."
          control={
            <Toggle
              label="Show the printed page"
              checked={prefs.page_view}
              onChange={(v) => setPrefs({ page_view: v })}
            />
          }
        />
      </Section>

      <Section title="The side panel">
        <Row
          label="Open by default"
          sub="contents, highlights, the dictionary and the levelling tools"
          control={
            <Toggle
              label="Side panel open by default"
              checked={prefs.panel_open}
              onChange={(v) => setPrefs({ panel_open: v })}
            />
          }
        />
      </Section>
    </>
  );
}
