import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALIASES, type AliasLang } from './aliases';
import { kn } from './kn';
import { ml } from './ml';
import { ta } from './ta';

// The aliases table is the rule for every translated text in both apps: the
// owner app's dictionaries here, and the driver app's strings.xml.
const LANGS: AliasLang[] = ['ml', 'ta', 'kn'];
const DICTS: Record<AliasLang, Record<string, string>> = { ml, ta, kn };
const RES = fileURLToPath(new URL('../../../../driver-app/app/src/main/res/', import.meta.url));

interface Text {
  where: string;
  english: string;
  translated: string;
}

/** A strings.xml as name → text, plural items as name/quantity → text. */
function strings(folder: string): Record<string, string> {
  const xml = readFileSync(`${RES}${folder}/strings.xml`, 'utf8');
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) out[m[1]] = m[2];
  for (const p of xml.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    for (const i of p[2].matchAll(/<item\s+quantity="([^"]+)"\s*>([\s\S]*?)<\/item>/g)) out[`${p[1]}/${i[1]}`] = i[2];
  }
  return out;
}

const driverEnglish = strings('values');

function texts(lang: AliasLang): Text[] {
  const owner = Object.entries(DICTS[lang]).map(([english, translated]) => ({ where: `owner app: ${english}`, english, translated }));
  const driver = Object.entries(strings(`values-${lang}`)).map(([name, translated]) => ({
    where: `driver app: ${name}`,
    english: driverEnglish[name] ?? '',
    translated,
  }));
  return [...owner, ...driver];
}

/** English as a reader sees it: no {placeholders}, no %1$d. */
const plain = (english: string) => english.replace(/\{\w+\}/g, '').replace(/%(\d+\$)?[sd]/g, '');

describe('the aliases table', () => {
  it('has every language for every term, and an applied word says what it replaces', () => {
    for (const alias of ALIASES) {
      for (const lang of LANGS) {
        const cell = alias[lang];
        expect(cell.use, `${alias.en} (${lang})`).not.toBe('');
        if (cell.status === 'proposed') continue;
        expect(alias.english, `${alias.en}: an applied term needs its English pattern`).toBeDefined();
        expect(cell.stem && cell.use.includes(cell.stem), `${alias.en} (${lang}): the word contains its stem`).toBe(true);
        expect(cell.avoid?.length, `${alias.en} (${lang}): the words it replaces`).toBeGreaterThan(0);
      }
    }
  });

  for (const alias of ALIASES) {
    for (const lang of LANGS) {
      const cell = alias[lang];
      if (cell.status === 'proposed' || !alias.english || !cell.stem || !cell.avoid) continue;
      const { english, stem, avoid } = { english: alias.english, stem: cell.stem, avoid: cell.avoid };

      it(`${alias.en} is ${cell.use} in ${lang}: never ${avoid.join(', ')}`, () => {
        const offenders = texts(lang).filter((t) => avoid.some((w) => t.translated.includes(w)));
        expect(offenders.map((t) => `${t.where} → ${t.translated}`)).toEqual([]);
      });

      it(`${alias.en}: every ${lang} text whose English names it says ${cell.use}`, () => {
        const missing = texts(lang).filter((t) => english.test(plain(t.english)) && !t.translated.includes(stem));
        expect(missing.map((t) => `${t.where} → ${t.translated}`)).toEqual([]);
      });
    }
  }
});
