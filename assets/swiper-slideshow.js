/**
 * <swiper-slideshow> — banner slideshow powered by Swiper (https://swiperjs.com).
 *
 * Swiper itself is fetched from the jsDelivr CDN on demand (once per page, shared by
 * every instance), so pages without this section never pay for it.
 *
 * Config is read from data-* attributes on the element so the section can stay
 * declarative. Re-initialises safely when the theme editor re-renders the section.
 */

const SWIPER_ESM = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.mjs';

/** @type {Promise<any> | null} */
let swiperModule = null;

function loadSwiper() {
  if (!swiperModule) {
    swiperModule = import(SWIPER_ESM).then((mod) => mod.default || mod.Swiper);
  }
  return swiperModule;
}

class SwiperSlideshow extends HTMLElement {
  /** @type {any} */
  swiper = null;

  /** @type {AbortController | null} */
  #abort = null;

  connectedCallback() {
    this.#abort = new AbortController();
    this.#init();
  }

  disconnectedCallback() {
    this.#abort?.abort();
    this.#abort = null;
    this.swiper?.destroy(true, false);
    this.swiper = null;
  }

  get #config() {
    const d = this.dataset;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    return {
      autoplay: d.autoplay === 'true' && !reducedMotion,
      delay: Math.max(1000, Number(d.delay) || 5000),
      loop: d.loop === 'true',
      effect: d.effect === 'fade' ? 'fade' : 'slide',
      speed: Number(d.speed) || 600,
      spaceBetween: Number(d.space) || 0,
      pauseOnHover: d.pauseOnHover === 'true',
      arrows: d.arrows === 'true',
      pagination: d.pagination === 'true',
    };
  }

  async #init() {
    const container = this.querySelector('.swiper');
    const slides = this.querySelectorAll('.swiper-slide');
    if (!container || slides.length < 2) return;

    const signal = this.#abort?.signal;
    const cfg = this.#config;

    let Swiper;
    try {
      Swiper = await loadSwiper();
    } catch (error) {
      console.warn('[swiper-slideshow] Swiper failed to load', error);
      return;
    }

    // Element was removed (e.g. editor re-render) while Swiper was downloading.
    if (signal?.aborted || !this.isConnected) return;

    /** @type {Record<string, any>} */
    const options = {
      slidesPerView: 1,
      loop: cfg.loop,
      speed: cfg.speed,
      spaceBetween: cfg.spaceBetween,
      effect: cfg.effect,
      grabCursor: true,
      watchOverflow: true,
      a11y: { enabled: true },
      keyboard: { enabled: true, onlyInViewport: true },
    };

    if (cfg.effect === 'fade') {
      options.fadeEffect = { crossFade: true };
    }

    if (cfg.autoplay) {
      options.autoplay = {
        delay: cfg.delay,
        disableOnInteraction: false,
        pauseOnMouseEnter: cfg.pauseOnHover,
      };
    }

    if (cfg.arrows) {
      options.navigation = {
        nextEl: this.querySelector('.sws__arrow--next'),
        prevEl: this.querySelector('.sws__arrow--prev'),
      };
    }

    if (cfg.pagination) {
      options.pagination = {
        el: this.querySelector('.sws__pagination'),
        clickable: true,
        bulletClass: 'sws__bullet',
        bulletActiveClass: 'is-active',
        renderBullet: (index, className) =>
          `<button type="button" class="${className}" aria-label="Go to slide ${index + 1}"></button>`,
      };
    }

    this.swiper = new Swiper(container, options);
    this.classList.add('is-ready');

    if (window.Shopify?.designMode) {
      this.#bindEditorEvents(signal);
    }
  }

  /**
   * Theme editor: jump to the block the merchant clicks, and hold autoplay while it's selected.
   * @param {AbortSignal | undefined} signal
   */
  #bindEditorEvents(signal) {
    this.addEventListener(
      'shopify:block:select',
      (event) => {
        const slide = /** @type {HTMLElement} */ (event.target).closest('.swiper-slide');
        if (!slide || !this.swiper) return;

        const index = Number(slide.dataset.index);
        if (this.swiper.params.loop) {
          this.swiper.slideToLoop(index);
        } else {
          this.swiper.slideTo(index);
        }
        this.swiper.autoplay?.stop();
      },
      { signal }
    );

    this.addEventListener(
      'shopify:block:deselect',
      () => {
        if (this.#config.autoplay) this.swiper?.autoplay?.start();
      },
      { signal }
    );
  }
}

if (!customElements.get('swiper-slideshow')) {
  customElements.define('swiper-slideshow', SwiperSlideshow);
}
