// Transactional e-mails (orders, contact form) sent through the shop's own mailbox (SMTP, e.g. Hostinger).
// Settings live in settings.emails and are edited from Dashboard → Settings → Emails.
// Sending never blocks or breaks an order: failures are logged on the order and in the audit log.
import { query, one } from './db.js';
import { getSetting, audit } from './lib.js';

export const EMAIL_TYPES = {
  new_order: { label: 'New order', to: 'shop', description: 'Sent to you when a customer orders on the website' },
  cancelled_order: { label: 'Cancelled order', to: 'shop', description: 'Sent to you when a website order is cancelled' },
  customer_processing: { label: 'Order received', to: 'customer', description: 'Sent to the customer right after ordering on the website' },
  customer_completed: { label: 'Order completed', to: 'customer', description: 'Sent to the customer when you mark the order completed (delivered)' },
  customer_refunded: { label: 'Order refunded', to: 'customer', description: 'Sent to the customer when an order is refunded' },
  customer_note: { label: 'Note to customer', to: 'customer', description: 'Sent when you add a note for the customer on an order' },
  contact_form: { label: 'Contact form', to: 'shop', description: 'Messages sent from the Contact Us page' },
};

export async function emailSettings() {
  const store = await getSetting('store', {});
  const s = await getSetting('emails', {});
  return {
    from_name: s.from_name || store.name || 'Poudre Beauty',
    from_email: s.from_email || s.smtp_user || '',
    notify_to: s.notify_to || store.email || '',
    smtp_host: s.smtp_host || process.env.SMTP_HOST || 'smtp.hostinger.com',
    smtp_port: Number(s.smtp_port || process.env.SMTP_PORT || 465),
    smtp_user: s.smtp_user || process.env.SMTP_USER || '',
    smtp_pass: s.smtp_pass || process.env.SMTP_PASS || '',
    enabled: { ...Object.fromEntries(Object.keys(EMAIL_TYPES).map((k) => [k, true])), ...(s.enabled || {}) },
    store,
  };
}

const siteUrl = () => (process.env.URL || 'https://poudrebeauty.com').replace(/\/$/, '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
const json = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});

export async function sendMail({ to, subject, html, replyTo }, cfg = null) {
  cfg ||= await emailSettings();
  if (!cfg.smtp_user || !cfg.smtp_pass) throw new Error('E-mail sending is not set up yet (Settings → Emails)');
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host, port: cfg.smtp_port, secure: cfg.smtp_port === 465,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  return transport.sendMail({ from: { name: cfg.from_name, address: cfg.from_email || cfg.smtp_user }, to, subject, html, replyTo });
}

/** Shared layout, close to WooCommerce's default e-mail template */
export function layout(cfg, heading, body) {
  const url = siteUrl();
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1f">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 12px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e5e5">
<tr><td align="center" style="padding:28px 24px 8px"><a href="${url}"><img src="${url}/wp-content/uploads/2025/02/WhatsApp-Image-2025-02-04-at-11.23.31-AM.jpeg" alt="${esc(cfg.from_name)}" width="120" style="display:block;border:0"></a></td></tr>
<tr><td style="padding:12px 32px 0"><h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#1f1f1f">${heading}</h1></td></tr>
<tr><td style="padding:0 32px 32px;font-size:14px;line-height:1.6">${body}</td></tr>
</table>
<p style="font-size:12px;color:#8a8a8a;margin:16px 0 0">${esc(cfg.from_name)}${cfg.store?.phone ? ` · ${esc(cfg.store.phone)}` : ''} · <a href="${url}" style="color:#8a8a8a">${url.replace(/^https?:\/\//, '')}</a></p>
</td></tr></table></body></html>`;
}

function address(a) {
  a = json(a);
  const lines = [[a.first_name, a.last_name].filter(Boolean).join(' '), a.company, a.address_1, a.address_2, [a.city, a.state].filter(Boolean).join(', '), a.phone, a.email].filter(Boolean);
  return lines.map(esc).join('<br>') || '—';
}

function orderTable(order, items) {
  const row = (l, r, bold) => `<tr><th align="left" style="padding:8px 10px;border-top:1px solid #eee;font-weight:${bold ? 600 : 400}">${l}</th><td align="right" style="padding:8px 10px;border-top:1px solid #eee;font-weight:${bold ? 600 : 400}">${r}</td></tr>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-collapse:collapse;font-size:14px;margin:8px 0 20px">
<tr style="background:#fafafa"><th align="left" style="padding:8px 10px">Product</th><th align="center" style="padding:8px 10px">Qty</th><th align="right" style="padding:8px 10px">Price</th></tr>
${items.map((i) => `<tr><td style="padding:8px 10px;border-top:1px solid #eee">${esc(i.name)}${i.sku ? `<br><span style="color:#8a8a8a;font-size:12px">${esc(i.sku)}</span>` : ''}</td><td align="center" style="padding:8px 10px;border-top:1px solid #eee">${i.quantity}</td><td align="right" style="padding:8px 10px;border-top:1px solid #eee">${fmt(i.subtotal)}</td></tr>`).join('')}
</table><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-collapse:collapse;font-size:14px">
${row('Subtotal', fmt(order.subtotal))}
${Number(order.discount_total) > 0 ? row(`Discount${order.coupon_codes?.length ? ` (${esc(order.coupon_codes.join(', '))})` : ''}`, `−${fmt(order.discount_total)}`) : ''}
${order.shipping_method || Number(order.shipping_total) > 0 ? row('Delivery', `${Number(order.shipping_total) > 0 ? fmt(order.shipping_total) : 'Free'}${order.shipping_method ? ` <span style="color:#8a8a8a">via ${esc(order.shipping_method)}</span>` : ''}`) : ''}
${row('Payment method', esc(order.payment_title || order.payment_method || '—'))}
${Number(order.refunded_total) > 0 ? row('Refunded', `−${fmt(order.refunded_total)}`) : ''}
${row('Total', fmt(Number(order.total) - Number(order.refunded_total || 0)), true)}
</table>
${order.customer_note ? `<p style="margin:16px 0 0"><b>Note:</b> ${esc(order.customer_note)}</p>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;font-size:14px"><tr>
<td valign="top" width="50%" style="padding-right:8px"><h3 style="font-size:15px;margin:0 0 6px">Billing address</h3><div style="border:1px solid #eee;padding:10px;color:#444">${address(order.billing)}</div></td>
<td valign="top" width="50%" style="padding-left:8px"><h3 style="font-size:15px;margin:0 0 6px">Delivery address</h3><div style="border:1px solid #eee;padding:10px;color:#444">${address(order.shipping)}</div></td>
</tr></table>`;
}

function compose(type, order, items, cfg, extra = {}) {
  const b = json(order.billing);
  const name = esc(b.first_name || 'there');
  const n = esc(order.number || order.id);
  const table = orderTable(order, items);
  switch (type) {
    case 'new_order': return { subject: `[${cfg.from_name}] New order #${n}`, heading: `New order #${n}`, body: `<p>You've received a new order from <b>${esc([b.first_name, b.last_name].filter(Boolean).join(' ') || b.phone || 'a customer')}</b>.</p>${table}<p><a href="${siteUrl()}/dashboard/orders/${order.id}" style="display:inline-block;background:#1f1f1f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none">Open in dashboard</a></p>` };
    case 'cancelled_order': return { subject: `[${cfg.from_name}] Order #${n} has been cancelled`, heading: 'Order cancelled', body: `<p>Order #${n} from ${esc([b.first_name, b.last_name].filter(Boolean).join(' '))} has been cancelled.</p>${table}` };
    case 'customer_processing': return { subject: `Your ${cfg.from_name} order has been received!`, heading: 'Thank you for your order', body: `<p>Hi ${name},</p><p>We've received your order #${n} and are now processing it. Here are the details:</p>${table}<p>Thanks for shopping with us.</p>` };
    case 'customer_completed': return { subject: `Your ${cfg.from_name} order is now complete`, heading: 'Thanks for shopping with us', body: `<p>Hi ${name},</p><p>Your order #${n} has been completed.</p>${table}<p>Thanks for shopping with us.</p>` };
    case 'customer_refunded': return { subject: `Your ${cfg.from_name} order #${n} has been refunded`, heading: 'Order refunded', body: `<p>Hi ${name},</p><p>Your order #${n} has been ${extra.partial ? 'partially ' : ''}refunded.</p>${table}` };
    case 'customer_note': return { subject: `Note added to your ${cfg.from_name} order #${n}`, heading: 'A note has been added to your order', body: `<p>Hi ${name},</p><blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #1f1f1f;background:#fafafa">${esc(extra.note).replace(/\n/g, '<br>')}</blockquote><p>For your reference, your order details are shown below.</p>${table}` };
    default: throw new Error(`Unknown e-mail ${type}`);
  }
}

/** Sends one order e-mail. Returns true when sent, false when skipped. Never throws. */
export async function sendOrderEmail(type, orderId, extra = {}) {
  try {
    const cfg = await emailSettings();
    if (!cfg.enabled[type]) return false;
    const order = await one('select * from orders where id = $1', [orderId]);
    if (!order) return false;
    const to = EMAIL_TYPES[type].to === 'shop' ? cfg.notify_to : json(order.billing).email;
    if (!to) return false;
    if (!cfg.smtp_user || !cfg.smtp_pass) { await note(orderId, `E-mail "${EMAIL_TYPES[type].label}" not sent: e-mail sending is not set up yet.`); return false; }
    const items = await query('select * from order_items where order_id = $1 order by id', [orderId]);
    const m = compose(type, order, items, cfg, extra);
    await sendMail({ to, subject: m.subject, html: layout(cfg, m.heading, m.body), replyTo: EMAIL_TYPES[type].to === 'shop' ? json(order.billing).email || undefined : cfg.notify_to || undefined }, cfg);
    await note(orderId, `E-mail "${EMAIL_TYPES[type].label}" sent to ${to}.`);
    return true;
  } catch (e) {
    console.error('mail', type, orderId, e.message);
    await note(orderId, `E-mail "${EMAIL_TYPES[type]?.label || type}" failed: ${e.message}`).catch(() => {});
    await audit(null, 'email_failed', 'order', orderId, { type, error: e.message });
    return false;
  }
}

async function note(orderId, text) {
  await query('insert into order_notes (order_id, note, author) values ($1, $2, $3)', [orderId, text, 'System']);
}

/** E-mails that follow a status change (only for website orders, like WooCommerce) */
export async function emailsForStatus(orderId, status) {
  const order = await one('select channel from orders where id = $1', [orderId]);
  if (!order || order.channel !== 'online') return;
  if (status === 'completed') await sendOrderEmail('customer_completed', orderId);
  if (status === 'cancelled') await sendOrderEmail('cancelled_order', orderId);
  if (status === 'refunded') await sendOrderEmail('customer_refunded', orderId);
}
