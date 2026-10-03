import { money, dateTime, fullName } from '../lib/format.js';

/** Thermal receipt (80 mm) or A4 invoice, printed through window.print() via a hidden iframe. */
export function receiptHtml(order, { store = {}, pos = {}, format = 'receipt' } = {}) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const name = fullName(order.billing || {});
  const lines = order.items.map((i) => `
    <tr><td>${esc(i.name)}${i.sku ? `<div class="m">${esc(i.sku)}</div>` : ''}</td>
    <td class="r">${i.quantity}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.subtotal)}</td></tr>`).join('');
  const row = (label, value, strong) => `<tr class="${strong ? 'b' : ''}"><td colspan="3">${label}</td><td class="r">${value}</td></tr>`;
  const lbp = store.secondary_currency?.rate && pos.show_lbp !== false
    ? `<p class="c m">≈ ${Math.round(order.total * store.secondary_currency.rate).toLocaleString('en-US')} LBP</p>` : '';
  const isA4 = format === 'invoice';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${isA4 ? 'Invoice' : 'Receipt'} #${esc(order.number)}</title><style>
    @page { size: ${isA4 ? 'A4' : '80mm auto'}; margin: ${isA4 ? '16mm' : '3mm'}; }
    body { font-family: ${isA4 ? '-apple-system, Segoe UI, Arial' : 'ui-monospace, Menlo, Consolas, monospace'}, sans-serif; font-size: ${isA4 ? '12px' : '11px'}; color: #000; margin: 0; ${isA4 ? '' : 'width: 74mm;'} }
    h1 { font-size: ${isA4 ? '22px' : '15px'}; margin: 0 0 4px; } .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
    .m { color: #555; font-size: 0.9em; } table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    td, th { padding: ${isA4 ? '6px 4px' : '2px 0'}; vertical-align: top; } th { text-align: left; border-bottom: 1px solid #000; font-weight: 600; }
    .items td { border-bottom: 1px ${isA4 ? 'solid #eee' : 'dashed #bbb'}; } .b td { font-weight: 700; font-size: 1.1em; border-top: 1px solid #000; }
    .head { display: flex; justify-content: space-between; ${isA4 ? 'margin-bottom: 24px;' : 'flex-direction: column; text-align: center;'} }
    hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  </style></head><body>
    <div class="head">
      <div><h1>${esc(pos.receipt_header || store.name || 'Poudre Beauty')}</h1>
        ${store.address ? `<div class="m">${esc(store.address)}</div>` : ''}${store.phone ? `<div class="m">${esc(store.phone)}</div>` : ''}</div>
      <div ${isA4 ? 'class="r"' : ''}><div><b>${isA4 ? 'Invoice' : 'Order'} #${esc(order.number)}</b></div><div class="m">${dateTime(order.created_at)}</div>
        ${order.staff_name ? `<div class="m">Served by ${esc(order.staff_name)}</div>` : ''}</div>
    </div>
    ${name && name !== 'Guest' ? `<div><b>Customer:</b> ${esc(name)}${order.billing?.phone ? ` · ${esc(order.billing.phone)}` : ''}</div>` : ''}
    ${isA4 && order.shipping?.address_1 ? `<div class="m">${esc([order.shipping.address_1, order.shipping.city].filter(Boolean).join(', '))}</div>` : ''}
    <table class="items"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>${lines}</tbody></table>
    <table>
      ${row('Subtotal', money(order.subtotal))}
      ${Number(order.discount_total) ? row('Discount', `-${money(order.discount_total)}`) : ''}
      ${Number(order.shipping_total) ? row('Delivery', money(order.shipping_total)) : ''}
      ${Number(order.fee_total) ? row('Fees', money(order.fee_total)) : ''}
      ${row('Total', money(order.total), true)}
      ${Number(order.refunded_total) ? row('Refunded', `-${money(order.refunded_total)}`) : ''}
      ${order.cash_tendered != null ? row('Cash', money(order.cash_tendered)) + row('Change', money(order.cash_change)) : row('Payment', esc(order.payment_title || order.payment_method || ''))}
    </table>
    ${lbp}
    <hr><p class="c">${esc(pos.receipt_footer || 'Thank you for shopping with us!')}</p>
  </body></html>`;
}

export function printOrder(order, opts) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(receiptHtml(order, opts));
  frame.contentDocument.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}
