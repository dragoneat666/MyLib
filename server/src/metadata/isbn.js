// isbn.js — ISBN cleanup, validation and 10 ⇄ 13 conversion.

export function cleanIsbn(value) {
  return String(value ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

export function isValidIsbn13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return sum % 10 === 0;
}

export function isbn10to13(s) {
  if (!isValidIsbn10(s)) return null;
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}

export function isbn13to10(s) {
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

// Returns { isbn13, isbn10 } for any valid ISBN-10/13 (isbn10 is null for 979-),
// or null when the input isn't an ISBN.
export function normalizeIsbn(value) {
  const s = cleanIsbn(value);
  if (s.length === 13 && isValidIsbn13(s) && (s.startsWith('978') || s.startsWith('979'))) {
    return { isbn13: s, isbn10: isbn13to10(s) };
  }
  if (s.length === 10 && isValidIsbn10(s)) return { isbn13: isbn10to13(s), isbn10: s };
  return null;
}

export function looksLikeIsbn(q) {
  return normalizeIsbn(q) !== null;
}
