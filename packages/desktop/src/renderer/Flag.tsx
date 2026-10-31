// A country flag from its two-letter code. Windows has no flag emoji, so the app carries the
// flag-icons SVGs (bundled, nothing fetched).

import { countryName } from './format';

const flags = import.meta.glob<string>('../../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byCode = new Map(
  Object.entries(flags).map(([file, url]) => [file.slice(-6, -4).toUpperCase(), url]),
);

export function Flag({ code }: { code: string | undefined }) {
  const url = code ? byCode.get(code.toUpperCase()) : undefined;
  if (!url) return null;
  return <img className="flag" src={url} alt={countryName(code) ?? ''} title={countryName(code)} />;
}
