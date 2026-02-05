
import { RedactionResult } from '../types';

/**
 * A basic client-side redactor using Regex.
 * In a production app, this would be more sophisticated.
 */
export const redactText = (text: string): RedactionResult => {
  let redactedText = text;
  const mappings: Record<string, string> = {};
  let counter = 1;

  // Pattern for Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = Array.from(new Set(text.match(emailRegex) || []));
  emails.forEach((email) => {
    const placeholder = `[EMAIL_${counter++}]`;
    mappings[placeholder] = email;
    redactedText = redactedText.split(email).join(placeholder);
  });

  // Pattern for Dates (approximate)
  const dateRegex = /(\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)|(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b)/gi;
  const dates = Array.from(new Set(text.match(dateRegex) || []));
  dates.forEach((date) => {
    const placeholder = `[DATE_${counter++}]`;
    mappings[placeholder] = date;
    redactedText = redactedText.split(date).join(placeholder);
  });

  // Pattern for common names/entities (Simplified for demo)
  // In real life, we would use an NER model or a much larger dictionary.
  // Here we just look for capitalized word sequences that aren't start of sentence.
  const commonLegalNames = ['LLC', 'Inc', 'Corp', 'Ltd', 'LLP', 'Company', 'Organization'];
  const namePattern = new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*\\s+(?:${commonLegalNames.join('|')}))`, 'g');
  const names = Array.from(new Set(text.match(namePattern) || []));
  names.forEach((name) => {
    const placeholder = `[ENTITY_${counter++}]`;
    mappings[placeholder] = name;
    redactedText = redactedText.split(name).join(placeholder);
  });

  return {
    originalText: text,
    redactedText,
    mappings
  };
};
