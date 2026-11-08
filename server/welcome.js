// Welcome offer for customers who create an account ("Subscribe now & get…"): their FIRST order, placed while signed
// in, gets 10 % off (each item at most 10 % under its regular price: an item already 5 % off only gets 5 % more) and
// free delivery. Applied automatically in the cart, checked again when the order is placed.
import { query } from './db.js';
import { birthdayLinesDiscount } from './birthday.js';

export const WELCOME_PERCENT = 10;
// One offer per customer, once: the welcome offer and the sign-up code count as the same one
export const WELCOME_MARK = 'welcome'; // kept in the coupons of the order that used the offer
export const SIGNUP_COUPON = 'poudre10';

/** True when this customer has an account, no order yet and has not used the sign-up code (cancelled / failed orders do not count) */
export async function welcomeEligible(customerId, q = query) {
  if (!customerId) return false;
  const [row] = await q(`select 1 ok from customers c where c.id = $1 and c.password_hash is not null
    and not exists (select 1 from orders o where o.status not in ('cancelled', 'failed')
      and (o.customer_id = c.id or (lower(o.billing->>'email') = lower(c.email) and $2 = any(o.coupon_codes))))`, [Number(customerId), SIGNUP_COUPON]);
  return !!row;
}

/** Discount of the welcome offer on lines { price, regular, quantity } */
export const welcomeDiscount = (lines) => Math.round(birthdayLinesDiscount(lines, WELCOME_PERCENT) * 100) / 100;
