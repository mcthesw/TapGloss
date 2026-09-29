// Numeric tokens are word-like to Intl.Segmenter, but are not vocabulary.
export function isNumericExpression(text: string) {
  return /\p{N}/u.test(text) && /^[\p{N}\p{P}\p{S}\s]+$/u.test(text);
}

// Passive reading should not turn isolated Latin letters into lookup targets.
// Explicit selections can still query meaningful one-letter words.
export function isReadingExpression(text: string) {
  const value = text.trim().normalize('NFC');
  return !!value && !isNumericExpression(value) && !/^\p{Script=Latin}\p{M}*$/u.test(value);
}
