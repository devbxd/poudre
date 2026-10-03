// HTML helpers that mirror WordPress escaping and price formatting.

/** esc_html / esc_attr */
export const esc = (s) => String(s ?? '')
  .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

/** wp_kses-free attribute escaping used for data-product_name (keeps apostrophes as &apos;) */
export const escName = (s) => esc(s).replace(/&#039;/g, '&apos;');

const NAMED = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', laquo: '«', raquo: '»' };
export const decodeEntities = (s) => String(s ?? '')
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);

/** PHP urlencode(): only letters, digits, - _ . stay; spaces become + */
export const phpUrlencode = (s) => encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');

const fmt = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** wc_price(): <span class="woocommerce-Price-amount amount">… */
export const wcPrice = (n, { bdi = false, symbol = '&#036;', translate = false } = {}) => {
  const sym = `<span class="woocommerce-Price-currencySymbol"${translate ? ' translate="no"' : ''}>${symbol}</span>`;
  const inner = `${sym}${fmt(n)}`;
  return `<span class="woocommerce-Price-amount amount">${bdi ? `<bdi>${inner}</bdi>` : inner}</span>`;
};

export const fill = (tpl, vars) => tpl.replace(/<!--@([a-z0-9_]+)-->/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
