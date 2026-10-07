/**
 * The languages Morbeez speaks (client Q&A, pilot baseline): English,
 * Malayalam, Kannada and Tamil — for the Owner and Driver apps, chosen per
 * user, and for what a customer receives, chosen per customer. Tax invoices
 * keep English as their official text.
 */
export const LANGUAGES = ['en', 'ml', 'kn', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];
