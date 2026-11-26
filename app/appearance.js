// Apply the site's saved color choice before the checkout paints.
export const themeBootstrap = `(() => {
  const page = document.documentElement;
  let savedLanguage;
  try {
    const theme = localStorage.getItem('0to1pay.theme');
    if (theme === 'light' || theme === 'dark') page.dataset.theme = theme;
    savedLanguage = localStorage.getItem('0to1pay.language');
  } catch {}
  const url = new URL(location.href);
  const explicit = url.searchParams.get('lang');
  if (explicit === 'ko' || explicit === 'en') {
    page.lang = explicit;
    return;
  }
  const preferred = savedLanguage === 'en' || savedLanguage === 'ko' ? savedLanguage
    : (navigator.languages || [navigator.language]).find(value => /^(en|ko)\\b/i.test(value))?.slice(0,2).toLowerCase();
  if (preferred && preferred !== page.lang) {
    url.searchParams.set('lang', preferred);
    window.stop();
    location.replace(url.href);
  }
})();`;

export function checkoutLanguage(query, accepted = '') {
  if (query === 'ko' || query === 'en') return query;
  const first = accepted.split(',')[0].trim().toLowerCase();
  return /^ko(?:-|;|$)/.test(first) ? 'ko' : 'en';
}

// The same icon works at the site root and on a mounted checkout.
export const brandIcon = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"48\" height=\"48\" viewBox=\"0 0 48 48\"><rect width=\"48\" height=\"48\" rx=\"11\" fill=\"#4055f5\"/><g fill=\"#fff\" transform=\"translate(0 4) skewY(-9)\"><path fill-rule=\"evenodd\" d=\"M10 11h15a2 2 0 0 1 2 2v23a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2Zm4 6v15h7V17Z\"/><rect x=\"31\" y=\"11\" width=\"7\" height=\"27\" rx=\"1.5\"/></g></svg>"
);
