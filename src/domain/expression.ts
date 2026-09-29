// Numeric tokens are word-like to Intl.Segmenter, but are not vocabulary.
export function isNumericExpression(text: string) {
  return /\p{N}/u.test(text) && /^[\p{N}\p{P}\p{S}\s]+$/u.test(text);
}
