/* eslint-disable camelcase */

// Languages (client Q&A, pilot baseline): the Owner and Driver apps in
// English, Malayalam, Kannada and Tamil, chosen per user; customer-facing
// communication in each customer's own preferred language, which the owner
// sets and can change. Tax invoices keep English as their official text
// (client Q&A: "English acceptable"), so nothing here touches invoices.

exports.shorthands = undefined;

const LANGS = "('en', 'ml', 'kn', 'ta')";

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'identity', name: 'app_user' }, {
    language: { type: 'text', notNull: true, default: 'en' },
  });
  pgm.addConstraint({ schema: 'identity', name: 'app_user' }, 'app_user_language_valid', { check: `language IN ${LANGS}` });

  pgm.addColumn({ schema: 'trading_partners', name: 'customer' }, {
    preferred_language: { type: 'text', notNull: true, default: 'en' },
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_preferred_language_valid', {
    check: `preferred_language IN ${LANGS}`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_preferred_language_valid');
  pgm.dropColumn({ schema: 'trading_partners', name: 'customer' }, 'preferred_language');
  pgm.dropConstraint({ schema: 'identity', name: 'app_user' }, 'app_user_language_valid');
  pgm.dropColumn({ schema: 'identity', name: 'app_user' }, 'language');
};
