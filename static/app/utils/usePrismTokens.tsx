import {useCallback, useEffect, useMemo, useState} from 'react';
import * as Sentry from '@sentry/react';
import Prism from 'prismjs';

import {trackAnalytics} from 'sentry/utils/analytics';
import {loadPrismLanguage, prismLanguageMap} from 'sentry/utils/prism';
import useOrganization from 'sentry/utils/useOrganization';

type PrismHighlightParams = {
  code: string;
  language: string;
};

export type SyntaxHighlightToken = {
  children: string;
  className: string;
};

export type SyntaxHighlightLine = SyntaxHighlightToken[];

type IntermediateToken = {
  children: string;
  types: Set<string>;
};

const useLoadPrismLanguage = (language: string, {onLoad}: {onLoad: () => void}) => {
  const organization = useOrganization({allowNull: true});

  useEffect(() => {
    if (!language) {
      return;
    }

    if (!prismLanguageMap[language.toLowerCase()]) {
      trackAnalytics('stack_trace.prism_missing_language', {
        organization,
        attempted_language: language.toLowerCase(),
      });
      return;
    }

    loadPrismLanguage(language, {onLoad});
  }, [language, onLoad, organization]);
};

const getPrismGrammar = (language: string) => {
  try {
    const fullLanguage = prismLanguageMap[language];
    return Prism.languages[fullLanguage] ?? null;
  } catch (e) {
    Sentry.captureException(e);
    return null;
  }
};

const splitMultipleTokensByLine = (
  tokens: Array<string | Prism.Token>,
  types: Set<string> = new Set(['token'])
) => {
  const lines: IntermediateToken[][] = [];
  let currentLine: IntermediateToken[] = [];

  for (const token of tokens) {
    const tokenLines = splitTokenContentByLine(token, new Set(types));
    if (tokenLines.length === 0) {
      continue;
    }

    currentLine.push(...tokenLines[0]);
    if (tokenLines.length > 1) {
      for (let i = 1; i < tokenLines.length; i++) {
        lines.push(currentLine);
        currentLine = tokenLines[i];
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
};

// Splits a token by newlines encounted inside of its content.
// Returns an array of lines. If the returned array only has a single
// line, no newlines were found.
const splitTokenContentByLine = (
  token: string | Prism.Token,
  types: Set<string> = new Set(['token'])
): IntermediateToken[][] => {
  if (typeof token === 'string') {
    const lines: IntermediateToken[][] = [];
    token.split(/\r?\n/).forEach(line => {
      if (line) {
        lines.push([{types: new Set(types), children: line}]);
      } else {
        // If empty string, new line was at the end of the token
        lines.push([]);
      }
    });
    return lines;
  }

  types.add(token.type);

  if (Array.isArray(token.content)) {
    return splitMultipleTokensByLine(token.content, new Set(types));
  }

  return splitTokenContentByLine(token.content, types);
};

const breakTokensByLine = (
  tokens: Array<string | Prism.Token>
): SyntaxHighlightLine[] => {
  const lines = splitMultipleTokensByLine(tokens);

  return lines.map(line =>
    line.map(token => ({
      children: token.children,
      className: [...token.types].join(' '),
    }))
  );
};

/**
 * Returns a list of tokens broken up by line for syntax highlighting.
 *
 * Meant to be used for code blocks which require custom UI and cannot rely
 * on Prism.highlightElement().
 *
 * Each token contains a `className` and `children` which can be used for
 * rendering like so: <span className={token.className}>{token.children}</span>
 *
 * Automatically handles importing of the language grammar.
 */
export const usePrismTokens = ({
  code,
  language,
}: PrismHighlightParams): SyntaxHighlightLine[] => {
  const [grammar, setGrammar] = useState<Prism.Grammar | null>(() =>
    getPrismGrammar(language)
  );

  const onLoad = useCallback(() => {
    setGrammar(getPrismGrammar(language));
  }, [language]);
  useLoadPrismLanguage(language, {onLoad});

  const lines = useMemo(() => {
    try {
      if (!grammar) {
        return breakTokensByLine([code]);
      }
      const tokens = Prism.tokenize(code, grammar);
      return breakTokensByLine(tokens);
    } catch (e) {
      Sentry.captureException(e);
      return [];
    }
  }, [grammar, code]);

  return lines;
};
