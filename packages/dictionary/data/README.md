Drop extra dictionary sources here to extend the game without editing TypeScript.

Supported folders:

- `allowed/*.txt`: extra accepted guesses
- `solutions/*.txt`: extra answer pool entries
- `banned/*.txt`: extra blocked terms

Format rules:

- one word per line
- UTF-8 text files
- blank lines are ignored
- lines starting with `#` are ignored
- accents, ligatures, punctuation, and casing are normalized by the loader

Recommended workflow:

1. Keep `solutions/` limited to high-quality answer words.
2. Put broad lexicons and inflected forms in `allowed/`.
3. Add profanity, slurs, and house bans in `banned/`.
4. Check `/admin` after each import to verify accepted counts by source.

Current generated source:

- `solutions/lexique-common-top1400.txt`: frequency-ranked Lexique 3.83 answer pool
- regenerate with `npm run dictionary:generate:lexique`

Suggested external sources to review before importing:

- Lexique / OpenLexicon frequency-driven French lexicons for common-answer filtering
- Hunspell or Dicollecte-style dictionaries for broad allowed guesses
- your own live reject logs, after manual review, for missing valid guesses

Review licenses before importing third-party data into production.
