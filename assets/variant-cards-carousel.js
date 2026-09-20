/**
 * Horizontal scroller for the "Image cards" variant picker style.
 *
 * Kept deliberately light: the surrounding <variant-picker> re-renders (morphs)
 * its markup on every variant change, so this element only relies on delegated
 * events and re-reads the DOM each time instead of caching child references.
 */
class VariantCardsCarousel extends HTMLElement {
  /** @type {ResizeObserver | undefined} */
  #resizeObserver;

  connectedCallback() {
    this.addEventListener('click', this.#onClick);
    this.#track?.addEventListener('scroll', this.#update, { passive: true });

    this.#resizeObserver = new ResizeObserver(this.#update);
    this.#resizeObserver.observe(this);

    requestAnimationFrame(() => {
      this.#revealSelected();
      this.#update();
    });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.#track?.removeEventListener('scroll', this.#update);
    this.#resizeObserver?.disconnect();
  }

  get #track() {
    return /** @type {HTMLElement | null} */ (this.querySelector('.variant-cards__track'));
  }

  get #cards() {
    return /** @type {HTMLElement[]} */ (Array.from(this.querySelectorAll('.variant-cards__card')));
  }

  /** @param {Event} event */
  #onClick = (event) => {
    if (!(event.target instanceof Element)) return;

    const arrow = event.target.closest('[data-variant-cards-arrow]');
    if (!(arrow instanceof HTMLElement)) return;

    event.preventDefault();

    const track = this.#track;
    const card = this.#cards[0];
    if (!track || !card) return;

    const gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
    const direction = arrow.dataset.variantCardsArrow === 'prev' ? -1 : 1;

    track.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: 'smooth' });
  };

  /** Scrolls the checked card into view on first render (no animation). */
  #revealSelected() {
    const track = this.#track;
    if (!track) return;

    const checked = this.querySelector('input:checked');
    const card = checked?.closest('.variant-cards__card');
    if (!(card instanceof HTMLElement)) return;

    const cardStart = card.offsetLeft - track.offsetLeft;
    const cardEnd = cardStart + card.offsetWidth;
    const viewStart = track.scrollLeft;
    const viewEnd = viewStart + track.clientWidth;

    if (cardStart >= viewStart && cardEnd <= viewEnd) return;

    track.scrollLeft = Math.max(0, cardStart - (track.clientWidth - card.offsetWidth) / 2);
  }

  /** Toggles arrow visibility / disabled state from the current scroll position. */
  #update = () => {
    const track = this.#track;
    if (!track) return;

    const maxScroll = track.scrollWidth - track.clientWidth;
    const hasOverflow = maxScroll > 1;

    this.toggleAttribute('data-has-overflow', hasOverflow);

    const prev = this.querySelector('[data-variant-cards-arrow="prev"]');
    const next = this.querySelector('[data-variant-cards-arrow="next"]');

    if (prev instanceof HTMLButtonElement) prev.disabled = !hasOverflow || track.scrollLeft <= 1;
    if (next instanceof HTMLButtonElement) next.disabled = !hasOverflow || track.scrollLeft >= maxScroll - 1;
  };
}

if (!customElements.get('variant-cards-carousel')) {
  customElements.define('variant-cards-carousel', VariantCardsCarousel);
}
