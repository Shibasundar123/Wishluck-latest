import { fetchConfig } from '@theme/utilities';
import { StandardEvents, CartLinesUpdateEvent } from '@shopify/events';

/**
 * Line item property used to mark the line this feature added itself, so it can be
 * told apart from the same variant added on purpose by the shopper, and so it
 * doesn't count toward its own qualifying quantity.
 */
const GIFT_PROPERTY_KEY = '_auto_gift';
const GIFT_PROPERTY_VALUE = 'true';

/** Class toggled on every `cart-items-component` while this feature is adding/removing its line. */
const LOADING_CLASS = 'cart-gift-threshold-loading';

/**
 * Watches the cart and automatically adds a configured "gift" variant once the
 * shopper's cart reaches a minimum item count, removing it again if the cart
 * later drops back below that count.
 *
 * Configuration comes from `window.CartGiftThresholdConfig`, rendered by
 * `snippets/scripts.liquid` from the "Free gift at item count" theme settings.
 * This only decides whether the line exists in the cart — making it actually
 * free at checkout still requires a matching Shopify automatic discount.
 */
class CartGiftThreshold {
  /** @type {boolean} */
  #busy = false;

  /** @param {{ variantId: number, minQuantity: number }} config */
  constructor(config) {
    this.config = config;
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#onCartUpdate);
    this.#evaluate();
  }

  /** @param {CartLinesUpdateEvent} event */
  #onCartUpdate = (event) => {
    // This theme dispatches cart-update events optimistically, before the
    // underlying request finishes — evaluating immediately would read stale
    // cart data (e.g. a quantity change in the cart that hasn't landed yet).
    // Wait for the real result, and reuse its items instead of fetching again.
    if (event.promise) {
      event.promise
        .then(({ detail }) => this.#evaluate(/** @type {any} */ (detail)?.items))
        .catch(() => {});
    } else {
      this.#evaluate();
    }
  };

  /**
   * @param {{ properties?: Record<string, string> }} item
   */
  #isAutoGiftLine(item) {
    return item.properties?.[GIFT_PROPERTY_KEY] === GIFT_PROPERTY_VALUE;
  }

  /** @param {any[]} [knownItems] - Cart items already known from the triggering event, to skip a redundant fetch. */
  async #evaluate(knownItems) {
    if (this.#busy) return;
    this.#busy = true;

    try {
      const items = knownItems ?? (await this.#fetchCart()).items ?? [];
      const giftLine = items.find((item) => this.#isAutoGiftLine(item));
      const qualifyingQuantity = items.reduce(
        (total, item) => (this.#isAutoGiftLine(item) ? total : total + item.quantity),
        0
      );

      if (qualifyingQuantity >= this.config.minQuantity) {
        if (!giftLine) await this.#withLoader(() => this.#addGift());
      } else if (giftLine) {
        await this.#withLoader(() => this.#removeGift(giftLine.key));
      }
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('[cart-gift-threshold]', error);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Shows a small spinner over every cart-items-component (drawer and/or page)
   * for the duration of an actual add/remove request.
   * @param {() => Promise<void>} action
   */
  async #withLoader(action) {
    const targets = document.querySelectorAll('cart-items-component');
    targets.forEach((el) => el.classList.add(LOADING_CLASS));

    try {
      await action();
    } finally {
      targets.forEach((el) => el.classList.remove(LOADING_CLASS));
    }
  }

  async #fetchCart() {
    const cartItemsComponent = document.querySelector('cart-items-component');

    if (cartItemsComponent && typeof (/** @type {any} */ (cartItemsComponent).fetchCartData) === 'function') {
      await customElements.whenDefined('cart-items-component');
      return /** @type {any} */ (cartItemsComponent).fetchCartData();
    }

    const response = await fetch(`${Theme.routes.cart_url}.json`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status}`);
    return response.json();
  }

  async #addGift() {
    const body = JSON.stringify({
      items: [
        {
          id: this.config.variantId,
          quantity: 1,
          properties: { [GIFT_PROPERTY_KEY]: GIFT_PROPERTY_VALUE },
        },
      ],
    });

    const response = await fetch(Theme.routes.cart_add_url, {
      ...fetchConfig('json', { body }),
      credentials: 'same-origin',
    });
    if (!response.ok) return;

    // /cart/add.js only returns the added line(s), not the full cart — fetch it for the notification below.
    const cart = await this.#fetchCart();
    await this.#notifyGiftAdded(cart);
  }

  /** @param {string} lineKey */
  async #removeGift(lineKey) {
    const body = JSON.stringify({ id: lineKey, quantity: 0 });

    const response = await fetch(Theme.routes.cart_change_url, {
      ...fetchConfig('json', { body }),
      credentials: 'same-origin',
    });
    if (!response.ok) return;

    // /cart/change.js returns the full updated cart directly, so no extra fetch is needed here.
    const cart = await response.json();
    await this.#notifyGiftRemoved(cart);
  }

  /** @param {any} cart */
  async #notifyGiftAdded(cart) {
    const deferred = CartLinesUpdateEvent.createPromise();

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        items: cart.items,
        itemCount: cart.item_count,
        source: 'cart-gift-threshold',
        didError: false,
      },
    });

    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'cart',
        lines: [{ merchandiseId: String(this.config.variantId), quantity: 1 }],
        promise: deferred.promise,
      })
    );
  }

  /** @param {any} cart */
  async #notifyGiftRemoved(cart) {
    const deferred = CartLinesUpdateEvent.createPromise();

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        items: cart.items,
        itemCount: cart.item_count,
        source: 'cart-gift-threshold',
        didError: false,
      },
    });

    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'remove',
        context: 'cart',
        lines: [{ id: String(this.config.variantId), quantity: 0 }],
        promise: deferred.promise,
      })
    );
  }
}

const config = /** @type {any} */ (window).CartGiftThresholdConfig;
if (config?.enabled && config.variantId && config.minQuantity > 0) {
  new CartGiftThreshold(config);
}
