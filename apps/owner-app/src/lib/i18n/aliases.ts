/**
 * The aliases table — the one word each language uses for the app's core
 * terms. The client (20 Nov 2026): dictionary translations read awkwardly;
 * people say the English word, so the app should too, written in their own
 * script — "Customer" is കസ്റ്റമർ in Malayalam and கஸ்டமர் in Tamil, not
 * ഉപഭോക്താവ് or வாடிக்கையாளர். Where the everyday word is already a native
 * one (profit ലാഭം, price വില), it stays.
 *
 * One row per term, a cell per language:
 * - `now` — what the app said before the table (for the client's review);
 * - `use` — the word (`plural` when it differs), its inflections written as
 *   people say them (കസ്റ്റമറെ, கஸ்டமருக்கு, ಕಸ್ಟಮರ್‌ಗೆ);
 * - `status` — `confirmed` by the client; `applied` by the same rule, for the
 *   client to confirm; `proposed`, not applied yet.
 *
 * A confirmed or applied cell is the rule in both apps — the owner app's
 * dictionaries and the driver app's strings.xml: no translation uses an
 * `avoid` word, and every text whose English names the term carries `stem`
 * (aliases.test.ts). To change a word: change the row, rewrite the strings
 * the test then lists, and keep the row's status honest.
 */
export type AliasLang = 'ml' | 'ta' | 'kn';
export type AliasStatus = 'confirmed' | 'applied' | 'proposed';

export interface AliasCell {
  now: string;
  use: string;
  plural?: string;
  status: AliasStatus;
  /** What every inflection of `use` contains; required once applied. */
  stem?: string;
  /** The words `use` replaces; required once applied. */
  avoid?: string[];
}

export interface Alias {
  en: string;
  /** Matches the term in English text (placeholders and %d removed). */
  english?: RegExp;
  note?: string;
  ml: AliasCell;
  ta: AliasCell;
  kn: AliasCell;
}

const keep = (now: string): AliasCell => ({ now, use: now, status: 'proposed' });
const propose = (now: string, use: string): AliasCell => ({ now, use, status: 'proposed' });

export const ALIASES: Alias[] = [
  {
    en: 'Customer',
    english: /\bcustomers?\b/i,
    note: 'The client’s own example (ml, ta). Kannada follows the same rule — to confirm.',
    ml: { now: 'ഉപഭോക്താവ്', use: 'കസ്റ്റമർ', plural: 'കസ്റ്റമേഴ്സ്', status: 'confirmed', stem: 'കസ്റ്റമ', avoid: ['ഉപഭോക്ത'] },
    ta: { now: 'வாடிக்கையாளர்', use: 'கஸ்டமர்', plural: 'கஸ்டமர்ஸ்', status: 'confirmed', stem: 'கஸ்டம', avoid: ['வாடிக்கையாள'] },
    kn: { now: 'ಗ್ರಾಹಕ', use: 'ಕಸ್ಟಮರ್', plural: 'ಕಸ್ಟಮರ್‌ಗಳು', status: 'applied', stem: 'ಕಸ್ಟಮ', avoid: ['ಗ್ರಾಹಕ'] },
  },
  { en: 'Farmer', note: 'The native word is the everyday one.', ml: keep('കർഷകൻ'), ta: keep('விவசாயி'), kn: keep('ರೈತ') },
  { en: 'Agent', ml: keep('ഏജന്റ്'), ta: propose('முகவர்', 'ஏஜென்ட்'), kn: keep('ಏಜೆಂಟ್') },
  { en: 'Trip', ml: keep('ട്രിപ്പ്'), ta: propose('பயணம்', 'ட்ரிப்'), kn: keep('ಟ್ರಿಪ್') },
  { en: 'Driver', ml: keep('ഡ്രൈവർ'), ta: propose('ஓட்டுநர்', 'டிரைவர்'), kn: propose('ಚಾಲಕ', 'ಡ್ರೈವರ್') },
  {
    en: 'Vehicle',
    note: 'Proposed: the everyday word (വണ്ടി) rather than “vehicle”, which few say — or the client’s choice.',
    ml: propose('വാഹനം', 'വണ്ടി'),
    ta: propose('வாகனம்', 'வண்டி'),
    kn: propose('ವಾಹನ', 'ಗಾಡಿ'),
  },
  { en: 'Route', ml: keep('റൂട്ട്'), ta: propose('வழித்தடம்', 'ரூட்'), kn: propose('ಮಾರ್ಗ', 'ರೂಟ್') },
  { en: 'Stock', ml: keep('സ്റ്റോക്ക്'), ta: propose('இருப்பு', 'ஸ்டாக்'), kn: keep('ಸ್ಟಾಕ್') },
  { en: 'Payment', ml: keep('പേയ്മെന്റ്'), ta: propose('கட்டணம்', 'பேமெண்ட்'), kn: propose('ಪಾವತಿ', 'ಪೇಮೆಂಟ್') },
  {
    en: 'Collection',
    note: 'The app says both today: പിരിവ് in most places, കളക്ഷൻ on the + menu.',
    ml: propose('പിരിവ്', 'കളക്ഷൻ'),
    ta: propose('வசூல்', 'கலெக்ஷன்'),
    kn: propose('ವಸೂಲಿ', 'ಕಲೆಕ್ಷನ್'),
  },
  { en: 'Credit', ml: keep('ക്രെഡിറ്റ്'), ta: propose('கடன்', 'கிரெடிட்'), kn: keep('ಕ್ರೆಡಿಟ್') },
  { en: 'Outstanding / Balance', ml: keep('ബാക്കി'), ta: propose('நிலுவை', 'பாக்கி'), kn: keep('ಬಾಕಿ') },
  { en: 'Advance', ml: keep('അഡ്വാൻസ്'), ta: propose('முன்பணம்', 'அட்வான்ஸ்'), kn: propose('ಮುಂಗಡ', 'ಅಡ್ವಾನ್ಸ್') },
  {
    en: 'Purchase / Procurement',
    note: 'The + menu’s “New procurement” would read പുതിയ പർച്ചേസ്.',
    ml: propose('വാങ്ങൽ / സംഭരണം', 'പർച്ചേസ്'),
    ta: propose('கொள்முதல்', 'பர்சேஸ்'),
    kn: propose('ಖರೀದಿ', 'ಪರ್ಚೇಸ್'),
  },
  { en: 'Sales', ml: propose('വിൽപ്പന', 'സെയിൽസ്'), ta: propose('விற்பனை', 'சேல்ஸ்'), kn: propose('ಮಾರಾಟ', 'ಸೇಲ್ಸ್') },
  { en: 'Finance', ml: keep('ഫിനാൻസ്'), ta: propose('நிதி', 'ஃபைனான்ஸ்'), kn: propose('ಹಣಕಾಸು', 'ಫೈನಾನ್ಸ್') },
  { en: 'Operations', ml: propose('പ്രവർത്തനങ്ങൾ', 'ഓപ്പറേഷൻസ്'), ta: propose('செயல்பாடுகள்', 'ஆப்பரேஷன்ஸ்'), kn: propose('ಕಾರ್ಯಾಚರಣೆ', 'ಆಪರೇಷನ್ಸ್') },
  { en: 'Home', ml: keep('ഹോം'), ta: propose('முகப்பு', 'ஹோம்'), kn: propose('ಮುಖಪುಟ', 'ಹೋಮ್') },
  { en: 'Owner', ml: propose('ഉടമ', 'ഓണർ'), ta: propose('உரிமையாளர்', 'ஓனர்'), kn: propose('ಮಾಲೀಕ', 'ಓನರ್') },
  { en: 'Staff / Workforce', ml: propose('ജീവനക്കാർ', 'സ്റ്റാഫ്'), ta: propose('பணியாளர்கள்', 'ஸ்டாஃப்'), kn: propose('ಸಿಬ್ಬಂದಿ', 'ಸ್ಟಾಫ್') },
  { en: 'Approve', ml: propose('അംഗീകരിക്കുക', 'അപ്രൂവ് ചെയ്യുക'), ta: propose('ஒப்புதல் அளி', 'அப்ரூவ் செய்'), kn: propose('ಅನುಮೋದಿಸಿ', 'ಅಪ್ರೂವ್ ಮಾಡಿ') },
  { en: 'Cash', ml: propose('പണം', 'ക്യാഷ്'), ta: propose('பணம்', 'கேஷ்'), kn: propose('ನಗದು', 'ಕ್ಯಾಶ್') },
  { en: 'Rate', ml: propose('നിരക്ക്', 'റേറ്റ്'), ta: propose('விலை', 'ரேட்'), kn: propose('ದರ', 'ರೇಟ್') },
  { en: 'Fuel', ml: propose('ഇന്ധനം', 'ഫ്യൂവൽ'), ta: propose('எரிபொருள்', 'ஃபியூயல்'), kn: propose('ಇಂಧನ', 'ಫ್ಯೂಯಲ್') },
  { en: 'Price', note: 'The native word is the everyday one.', ml: keep('വില'), ta: keep('விலை'), kn: keep('ಬೆಲೆ') },
  { en: 'Profit', note: 'The native word is the everyday one.', ml: keep('ലാഭം'), ta: keep('லாபம்'), kn: keep('ಲಾಭ') },
  { en: 'Expense', note: 'The native word is the everyday one.', ml: keep('ചെലവ്'), ta: keep('செலவு'), kn: keep('ಖರ್ಚು') },
  { en: 'Labour', note: 'The native word is the everyday one.', ml: keep('കൂലി'), ta: keep('கூலி'), kn: keep('ಕೂಲಿ') },
];
