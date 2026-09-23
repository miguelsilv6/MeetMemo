import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import pt from './locales/pt.json';

/** localStorage key the language choice is persisted under. */
export const LANGUAGE_STORAGE_KEY = 'meetmemo-language';

export const SUPPORTED_LANGUAGES = ['pt', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// European Portuguese is the app's default UI language; a returning visitor's
// explicit choice (persisted to localStorage by the detector's cache) always
// wins. Browser/navigator language is intentionally not consulted, so an
// English-locale browser doesn't silently override the default.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    fallbackLng: 'pt',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
    interpolation: {
      escapeValue: false, // React already escapes rendered output
    },
    react: {
      // Resources are bundled inline (no async backend), so there is nothing
      // to suspend for; this avoids needing a <Suspense> boundary just to
      // render translated text.
      useSuspense: false,
    },
  });

export default i18n;
