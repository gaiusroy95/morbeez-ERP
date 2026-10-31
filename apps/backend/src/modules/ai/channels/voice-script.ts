// What an automated call says (AI Calling, requirements Part 23), in the
// customer's language, and the TwiML that tells Twilio to say it. The numbers
// in it — the amount due, the order's lines — are fixed by code when the call
// is placed (REC.1); the words are these templates. Malayalam, Kannada and
// Tamil are drafts for a native speaker to check, like the apps' own.

import { Language } from '../../../common/languages';

export type CallPurpose = 'payment_reminder' | 'order_reminder' | 'order_confirm';
export type CallStatus = 'queued' | 'ringing' | 'in_progress' | 'completed' | 'busy' | 'no_answer' | 'failed' | 'canceled';
export type CallOutcome = 'confirmed' | 'callback' | 'no_response';

/** The facts the call states, fixed when it was placed. */
export interface CallScript {
  business: string;
  /** A payment reminder: what's due now, in rupees. */
  amount?: string;
  /** An order: what's on it, already in words ("20 kilos Tomato, 10 kilos Onion"). */
  lines?: { name: string; quantity: string; uom: string }[];
  orderNumber?: string;
  deliveryDate?: string;
}

/** Google's Indian voices on Twilio, per language. */
export const VOICES: Record<Language, { language: string; voice: string }> = {
  en: { language: 'en-IN', voice: 'Google.en-IN-Standard-A' },
  ml: { language: 'ml-IN', voice: 'Google.ml-IN-Standard-A' },
  kn: { language: 'kn-IN', voice: 'Google.kn-IN-Standard-A' },
  ta: { language: 'ta-IN', voice: 'Google.ta-IN-Standard-A' },
};

const KILO: Record<Language, string> = { en: 'kilos', ml: 'കിലോ', kn: 'ಕಿಲೋ', ta: 'கிலோ' };

/** A quantity as said: "20 kilos Tomato" — trailing zeros dropped. */
export function linesInWords(lines: CallScript['lines'], lang: Language): string {
  return (lines ?? [])
    .map((l) => {
      const q = String(Number(l.quantity));
      const unit = l.uom.toLowerCase() === 'kg' ? KILO[lang] : l.uom;
      return `${q} ${unit} ${l.name}`;
    })
    .join(', ');
}

/** Rupees as a voice reads them best: digits, no grouping commas, paise only when there are any. */
export function rupeesInWords(amount: string): string {
  const n = Number(amount);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

type Lines = { greeting: string; body: string; press: string; thanks: Record<'1' | '2' | 'other', string> };

function script(purpose: CallPurpose, lang: Language, s: CallScript): Lines {
  const amount = s.amount ? rupeesInWords(s.amount) : '';
  const lines = linesInWords(s.lines, lang);
  switch (lang) {
    case 'ml':
      return {
        greeting: `നമസ്കാരം, ഇത് ${s.business} ആണ്.`,
        body:
          purpose === 'payment_reminder'
            ? `നിങ്ങളുടെ അക്കൗണ്ടിൽ ${amount} രൂപ അടയ്ക്കാനുണ്ട് എന്ന് ഓർമ്മിപ്പിക്കാനാണ് ഈ കോൾ.`
            : purpose === 'order_reminder'
              ? `നാളത്തേക്കുള്ള നിങ്ങളുടെ ഓർഡർ ഇതുവരെ കിട്ടിയിട്ടില്ല. നിങ്ങൾ സാധാരണ എടുക്കുന്നത്: ${lines}.`
              : `${s.deliveryDate ?? ''} ലെ നിങ്ങളുടെ ഓർഡർ ${s.orderNumber ?? ''}: ${lines}.`,
        press:
          purpose === 'payment_reminder'
            ? 'ഇന്ന് അടയ്ക്കുമെങ്കിൽ 1 അമർത്തുക. ഞങ്ങൾ തിരികെ വിളിക്കണമെങ്കിൽ 2 അമർത്തുക.'
            : purpose === 'order_reminder'
              ? 'സാധാരണ ഓർഡർ നാളെ വേണമെങ്കിൽ 1 അമർത്തുക. ഞങ്ങൾ തിരികെ വിളിക്കണമെങ്കിൽ 2 അമർത്തുക.'
              : 'ഇത് ശരിയാണെങ്കിൽ 1 അമർത്തുക. മാറ്റം വരുത്താൻ ഞങ്ങൾ തിരികെ വിളിക്കണമെങ്കിൽ 2 അമർത്തുക.',
        thanks: {
          '1': 'നന്ദി. ഞങ്ങൾ ഇത് രേഖപ്പെടുത്തി.',
          '2': `നന്ദി. ${s.business} ൽ നിന്ന് ഉടൻ തിരികെ വിളിക്കും.`,
          other: `ക്ഷമിക്കണം, മനസ്സിലായില്ല. ${s.business} ൽ നിന്ന് നിങ്ങളെ വിളിക്കും.`,
        },
      };
    case 'kn':
      return {
        greeting: `ನಮಸ್ಕಾರ, ಇದು ${s.business}.`,
        body:
          purpose === 'payment_reminder'
            ? `ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ${amount} ರೂಪಾಯಿ ಬಾಕಿ ಇದೆ ಎಂದು ನೆನಪಿಸಲು ಈ ಕರೆ.`
            : purpose === 'order_reminder'
              ? `ನಾಳೆಗೆ ನಿಮ್ಮ ಆರ್ಡರ್ ಇನ್ನೂ ಬಂದಿಲ್ಲ. ನೀವು ಸಾಮಾನ್ಯವಾಗಿ ತೆಗೆದುಕೊಳ್ಳುವುದು: ${lines}.`
              : `${s.deliveryDate ?? ''} ರ ನಿಮ್ಮ ಆರ್ಡರ್ ${s.orderNumber ?? ''}: ${lines}.`,
        press:
          purpose === 'payment_reminder'
            ? 'ಇಂದು ಪಾವತಿಸುವುದಾದರೆ 1 ಒತ್ತಿ. ನಾವು ಮರಳಿ ಕರೆ ಮಾಡಬೇಕಾದರೆ 2 ಒತ್ತಿ.'
            : purpose === 'order_reminder'
              ? 'ಸಾಮಾನ್ಯ ಆರ್ಡರ್ ನಾಳೆ ಬೇಕಾದರೆ 1 ಒತ್ತಿ. ನಾವು ಮರಳಿ ಕರೆ ಮಾಡಬೇಕಾದರೆ 2 ಒತ್ತಿ.'
              : 'ಇದು ಸರಿಯಾಗಿದ್ದರೆ 1 ಒತ್ತಿ. ಬದಲಾಯಿಸಲು ನಾವು ಮರಳಿ ಕರೆ ಮಾಡಬೇಕಾದರೆ 2 ಒತ್ತಿ.',
        thanks: {
          '1': 'ಧನ್ಯವಾದಗಳು. ನಾವು ಇದನ್ನು ದಾಖಲಿಸಿದ್ದೇವೆ.',
          '2': `ಧನ್ಯವಾದಗಳು. ${s.business} ನಿಂದ ಶೀಘ್ರದಲ್ಲೇ ಮರಳಿ ಕರೆ ಮಾಡುತ್ತೇವೆ.`,
          other: `ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ${s.business} ನಿಂದ ನಿಮಗೆ ಕರೆ ಮಾಡುತ್ತೇವೆ.`,
        },
      };
    case 'ta':
      return {
        greeting: `வணக்கம், இது ${s.business}.`,
        body:
          purpose === 'payment_reminder'
            ? `உங்கள் கணக்கில் ${amount} ரூபாய் செலுத்த வேண்டியுள்ளது என்பதை நினைவூட்டவே இந்த அழைப்பு.`
            : purpose === 'order_reminder'
              ? `நாளைக்கான உங்கள் ஆர்டர் இன்னும் வரவில்லை. நீங்கள் வழக்கமாக வாங்குவது: ${lines}.`
              : `${s.deliveryDate ?? ''} அன்று உங்கள் ஆர்டர் ${s.orderNumber ?? ''}: ${lines}.`,
        press:
          purpose === 'payment_reminder'
            ? 'இன்று செலுத்துவீர்கள் என்றால் 1 ஐ அழுத்தவும். நாங்கள் திரும்ப அழைக்க வேண்டுமென்றால் 2 ஐ அழுத்தவும்.'
            : purpose === 'order_reminder'
              ? 'வழக்கமான ஆர்டர் நாளை வேண்டுமென்றால் 1 ஐ அழுத்தவும். நாங்கள் திரும்ப அழைக்க வேண்டுமென்றால் 2 ஐ அழுத்தவும்.'
              : 'இது சரி என்றால் 1 ஐ அழுத்தவும். மாற்ற நாங்கள் திரும்ப அழைக்க வேண்டுமென்றால் 2 ஐ அழுத்தவும்.',
        thanks: {
          '1': 'நன்றி. நாங்கள் இதைப் பதிவு செய்துள்ளோம்.',
          '2': `நன்றி. ${s.business} இலிருந்து விரைவில் திரும்ப அழைப்போம்.`,
          other: `மன்னிக்கவும், புரியவில்லை. ${s.business} இலிருந்து உங்களை அழைப்போம்.`,
        },
      };
    default:
      return {
        greeting: `Hello, this is ${s.business}.`,
        body:
          purpose === 'payment_reminder'
            ? `This is a reminder that ${amount} rupees is due on your account.`
            : purpose === 'order_reminder'
              ? `We haven't had your order for tomorrow yet. What you usually take: ${lines}.`
              : `About your order ${s.orderNumber ?? ''} for ${s.deliveryDate ?? ''}: ${lines}.`,
        press:
          purpose === 'payment_reminder'
            ? 'Press 1 if you will pay today. Press 2 if you would like us to call you back.'
            : purpose === 'order_reminder'
              ? 'Press 1 if you want your usual order delivered tomorrow. Press 2 if you would like us to call you back.'
              : 'Press 1 if this is correct. Press 2 if you would like us to call you back to change it.',
        thanks: {
          '1': 'Thank you. We have noted it.',
          '2': `Thank you. Someone from ${s.business} will call you back soon.`,
          other: `Sorry, we didn't get that. Someone from ${s.business} will call you.`,
        },
      };
  }
}

/** What the call says first, in words — shown on AI Calling before the owner places it. */
export function spokenText(purpose: CallPurpose, lang: Language, s: CallScript): string {
  const l = script(purpose, lang, s);
  return `${l.greeting} ${l.body} ${l.press}`;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function say(lang: Language, text: string): string {
  const v = VOICES[lang];
  return `<Say language="${v.language}" voice="${v.voice}">${xml(text)}</Say>`;
}

/** The call: the message, then one key (asked twice), sent to [keypressUrl]. */
export function callTwiml(purpose: CallPurpose, lang: Language, s: CallScript, keypressUrl: string): string {
  const l = script(purpose, lang, s);
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Gather input="dtmf" numDigits="1" timeout="8" action="${xml(keypressUrl)}" method="POST">` +
    say(lang, `${l.greeting} ${l.body} ${l.press}`) +
    `<Pause length="1"/>${say(lang, l.press)}` +
    '</Gather>' +
    say(lang, l.thanks.other) +
    '<Hangup/></Response>'
  );
}

/** What the key meant, and the goodbye. */
export function keypressTwiml(purpose: CallPurpose, lang: Language, s: CallScript, digits: string): { outcome: CallOutcome; twiml: string } {
  const l = script(purpose, lang, s);
  const key = digits === '1' || digits === '2' ? digits : 'other';
  const outcome: CallOutcome = key === '1' ? 'confirmed' : key === '2' ? 'callback' : 'no_response';
  return { outcome, twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${say(lang, l.thanks[key])}<Hangup/></Response>` };
}

/** Twilio's CallStatus, as stored. */
export function statusOf(twilioStatus: string | undefined): CallStatus | null {
  switch (twilioStatus) {
    case 'queued':
    case 'initiated':
      return 'queued';
    case 'ringing':
      return 'ringing';
    case 'in-progress':
    case 'answered':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'busy':
      return 'busy';
    case 'no-answer':
      return 'no_answer';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return null;
  }
}

/** A finished call is never moved back by a late callback. */
export const FINAL: CallStatus[] = ['completed', 'busy', 'no_answer', 'failed', 'canceled'];
