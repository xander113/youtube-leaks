import Stripe from 'stripe';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { signedIn } from '../middleware/access.js';
import { fail, HttpError } from '../middleware/errors.js';
import { read } from '../middleware/validation.js';

export const planPrices = { basic: { monthly: 299, yearly: 3588 }, premium: { monthly: 499, yearly: 5988 } };
const planInput = z.object({ plan: z.enum(['basic', 'premium']), cycle: z.enum(['monthly', 'yearly']) });
const localInput = z.discriminatedUnion('action', [
  planInput.extend({ action: z.enum(['subscribe', 'change']) }),
  z.object({ action: z.literal('cancel') })
]);
const subscriptionEvents = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed', 'checkout.session.completed']);

export function billing(db, io) {
  const stripe = config.production && config.stripeKey && new Stripe(config.stripeKey, { timeout: 8000, maxNetworkRetries: 1 });
  let priceCheck;

  async function verifyPrices() {
    if (!config.production) return;
    if (!stripe) fail(503, 'Billing is not set up.');
    priceCheck ??= Promise.all(Object.entries(config.prices).flatMap(([plan, cycles]) =>
      Object.entries(cycles).map(async ([cycle, id]) => {
        const price = await stripe.prices.retrieve(id);
        if (!price.active || price.currency !== 'usd' || price.unit_amount !== planPrices[plan][cycle] ||
          price.recurring?.interval_count !== 1 || price.recurring?.interval !== (cycle === 'monthly' ? 'month' : 'year')) {
          throw new Error(`Stripe price ${plan}/${cycle} must be active and match the documented USD rate and period.`);
        }
      }))).catch(error => { priceCheck = null; throw error; });
    return priceCheck;
  }

  async function syncCustomer(customerId) {
    const revision = await db.one('UPDATE users SET billing_revision = billing_revision + 1 WHERE stripe_customer_id = ? RETURNING id, billing_revision',
      [customerId]);
    if (!revision) return;
    try {
      const result = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      const available = [];
      for (const subscription of result.data) {
        if (!['active', 'trialing'].includes(subscription.status)) continue;
        for (const item of subscription.items.data) {
          const plan = Object.keys(config.prices).find(tier => Object.values(config.prices[tier]).includes(item.price.id));
          const until = (item.current_period_end || subscription.current_period_end) * 1000;
          if (plan && until > Date.now()) available.push({ plan, until });
        }
      }
      available.sort((a, b) => Number(b.plan === 'premium') - Number(a.plan === 'premium') || b.until - a.until);
      const active = available[0];
      const updated = await db.one(`UPDATE users SET plan = ?, paid_until = ?
        WHERE id = ? AND billing_revision = ? RETURNING id`,
      [active?.plan ?? null, active?.until ?? null, revision.id, revision.billing_revision]);
      if (updated) {
        io.to(`account:${revision.id}`).emit('access:changed');
        io.to('admins').emit('admin:changed');
        io.emit('comments:changed');
      }
    } catch (error) {
      throw new HttpError(503, 'Could not sync this Stripe subscription.', error);
    }
  }

  async function customer(viewer) {
    const id = viewer.auth.id;
    const row = await db.one('SELECT stripe_customer_id FROM users WHERE id = ?', [id]);
    if (row?.stripe_customer_id) return row.stripe_customer_id;
    const key = createHash('sha256').update(JSON.stringify([config.appOrigin, id, viewer.auth.email])).digest('hex');
    const created = await stripe.customers.create({ email: viewer.auth.email, metadata: { watcher_id: String(id) } },
      { idempotencyKey: `ytl-customer-${key}` });
    const saved = await db.one('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL RETURNING stripe_customer_id',
      [created.id, id]);
    return saved?.stripe_customer_id || (await db.one('SELECT stripe_customer_id FROM users WHERE id = ?', [id])).stripe_customer_id;
  }

  function localWatcher(viewer) {
    if (config.production) fail(404, 'Page not found.');
    signedIn(viewer);
    if (viewer.auth.role !== 'watcher') fail(403, 'Plans are for Watchers.');
  }

  return {
    configured: !config.production || Boolean(stripe), verifyPrices,
    async localPlan(viewer) {
      localWatcher(viewer);
      const row = await db.one('SELECT plan FROM users WHERE id = ?', [viewer.auth.id]);
      return { plan: row.plan, paid: viewer.paid };
    },
    async localPayment(viewer, body) {
      localWatcher(viewer);
      const input = read(localInput, body);
      const cancel = input.action === 'cancel';
      const subscribe = input.action === 'subscribe';
      const now = Date.now();
      const until = cancel ? null : now + (input.cycle === 'yearly' ? 365 : 30) * 86400000;

      const actionCondition = subscribe
        ? "AND u.paid_override IS NULL AND (u.plan IS NULL OR COALESCE(u.paid_until, 0) <= ?) AND EXISTS (SELECT 1 FROM settings WHERE id = 1 AND paid = 1)"
        : "AND u.plan IS NOT NULL";
      const active = await db.one(`UPDATE users AS u SET plan = ?, paid_until = ?
        WHERE u.id = ? AND u.role = 'watcher' AND u.banned_at IS NULL ${actionCondition} RETURNING id`,
      [cancel ? null : input.plan, until, viewer.auth.id, ...(subscribe ? [now] : [])]);
      if (!active && !cancel) {
        fail(409, 'This plan change is unavailable. Go back to Plans and try again.');
      }
      io.to(`account:${viewer.auth.id}`).emit('access:changed');
      io.emit('comments:changed');
      io.to('admins').emit('admin:changed');
      return { url: subscribe ? '/plans?checkout=done' : '/plans' };
    },
    async checkout(viewer, body, redis) {
      signedIn(viewer);
      if (!viewer.paid || viewer.auth.role !== 'watcher') fail(403, 'Paid plans are for Watchers in paid mode.');
      const { plan, cycle } = read(planInput, body);
      if (viewer.auth.paidOverride === 'unpaid') fail(403, 'Contact support to change your access.');
      if (!config.production) {
        if (viewer.auth.tier) fail(409, 'Use Manage plan to change your subscription.');
        return { url: `/payment/checkout?plan=${plan}&cycle=${cycle}` };
      }
      await verifyPrices();

      const lock = `ytl:checkout:${viewer.auth.id}`;
      const lockToken = randomUUID();
      if (redis?.status !== 'ready') fail(503, 'Billing is busy. Try again in a moment.');
      if (!await redis.set(lock, lockToken, 'EX', 60, 'NX')) fail(409, 'A checkout is already starting.');
      try {
        const customerId = await customer(viewer);
        const active = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
        if (active.data.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) {
          fail(409, 'Use Manage plan to change or fix your subscription.');
        }
        const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 });
        for (const existing of open.data) {
          if (existing.metadata?.plan === plan && existing.metadata?.cycle === cycle) return { url: existing.url };
          await stripe.checkout.sessions.expire(existing.id);
        }
        const session = await stripe.checkout.sessions.create({
          customer: customerId, mode: 'subscription', payment_method_types: ['card'],
          line_items: [{ price: config.prices[plan][cycle], quantity: 1 }], metadata: { plan, cycle },
          success_url: `${config.appOrigin}/plans?checkout=done`, cancel_url: `${config.appOrigin}/plans`
        });
        return { url: session.url };
      } finally {
        await redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end", 1, lock, lockToken)
          .catch(error => console.error('Checkout lock release', error));
      }
    },
    async portal(viewer) {
      signedIn(viewer);
      if (!viewer.auth.hasBilling) fail(404, 'No billing account was found.');
      if (!config.production) return { url: '/payment/manage' };
      if (!stripe) fail(404, 'No billing account was found.');
      const user = await db.one('SELECT stripe_customer_id FROM users WHERE id = ?', [viewer.auth.id]);
      const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${config.appOrigin}/plans` });
      return { url: session.url };
    },
    async webhook(req, res) {
      if (!stripe) fail(404, 'Billing is not set up.');
      let event;
      try { event = stripe.webhooks.constructEvent(req.body, req.get('Stripe-Signature'), config.stripeWebhookSecret); }
      catch (error) { throw new HttpError(400, 'Stripe could not verify this request.', error); }
      const customerId = event.data.object.customer;
      if (subscriptionEvents.has(event.type) && typeof customerId === 'string') await syncCustomer(customerId);
      res.json({ received: true });
    }
  };
}
