// Welcome offer for customers who create an account ("Subscribe now & get…"): their FIRST order, placed while signed
// in, gets 10 % off (each item at most 10 % under its regular price: an item already 5 % off only gets 5 % more) and
// free delivery. Applied automatically in the cart, checked again when the order is placed.
import { query } from './db.js';
import { birthdayLinesDiscount } from './birthday.js';

export const WELCOME_PERCENT = 10;

/** True when this customer has an account and no order yet (cancelled / failed ones do not count) */
export async function welcomeEligible(customerId, q = query) {
  if (!customerId) return false;
  const [row] = await q(`select 1 ok from customers c where c.id = $1 and c.password_hash is not null
    and not exists (select 1 from orders o where o.customer_id = c.id and o.status not in ('cancelled', 'failed'))`, [Number(customerId)]);
  return !!row;
}

/** Discount of the welcome offer on lines { price, regular, quantity } */
export const welcomeDiscount = (lines) => Math.round(birthdayLinesDiscount(lines, WELCOME_PERCENT) * 100) / 100;
