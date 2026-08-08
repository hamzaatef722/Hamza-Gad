/**
 * Gift Guide Grid - popup + Add to Cart logic.
 * Pure vanilla JavaScript, no jQuery, no external libraries.
 *
 * Flow:
 *   1. User clicks a "+" hotspot on a product image in the grid.
 *   2. We fetch that product's data from Shopify's public Product JSON
 *      endpoint (/products/<handle>.js).
 *   3. We render the popup: title, price, description, and a variant
 *      picker built dynamically from product.options / product.variants.
 *   4. Changing an option re-matches the selected variant, updating the
 *      price and image.
 *   5. "Add to Cart" posts the selected variant id to /cart/add.js
 *      (Shopify's AJAX Cart API) and shows success/error feedback.
 */

(function () {
  "use strict";

  // Cache references to the (single, reused) popup elements.
  var popup = document.querySelector("[data-gift-popup]");
  if (!popup) return; // Grid section isn't on this page - nothing to do.

  var overlayCloseEls = popup.querySelectorAll("[data-gift-popup-close]");
  var imageEl = popup.querySelector("[data-gift-popup-image]");
  var titleEl = popup.querySelector("[data-gift-popup-title]");
  var priceEl = popup.querySelector("[data-gift-popup-price]");
  var descriptionEl = popup.querySelector("[data-gift-popup-description]");
  var optionsEl = popup.querySelector("[data-gift-popup-options]");
  var addToCartBtn = popup.querySelector("[data-gift-popup-add-to-cart]");
  var feedbackEl = popup.querySelector("[data-gift-popup-feedback]");

  // Holds the currently loaded product + the user's current option selections.
  var currentProduct = null;
  var selectedOptions = [];

  /**
   * Formats a price given in cents into a currency string using the
   * shop's active currency (falls back to a plain "$" prefix if the
   * Shopify.currency object isn't available on the page).
   */
  function formatMoney(cents) {
    var amount = (cents / 100).toFixed(2);
    if (
      window.Shopify &&
      window.Shopify.currency &&
      window.Shopify.currency.active
    ) {
      return amount + " " + window.Shopify.currency.active;
    }
    return "$" + amount;
  }

  /**
   * Finds the variant that matches the currently selected options.
   */
  function getSelectedVariant() {
    if (!currentProduct) return null;
    return currentProduct.variants.find(function (variant) {
      return variant.options.every(function (optionValue, index) {
        return optionValue === selectedOptions[index];
      });
    });
  }

  /**
   * Renders one <select> per product option (e.g. Size, Color).
   *
   * Note: Shopify's /products/<handle>.js response returns `options` as
   * an array of OBJECTS - { name, position, values } - not plain
   * strings. We read `.name` and `.values` directly instead of
   * re-deriving them from the variants list.
   */
  function renderOptions(product) {
    optionsEl.innerHTML = "";

    product.options.forEach(function (option, optionIndex) {
      var wrapper = document.createElement("div");
      wrapper.className = "gift-popup__option";

      var label = document.createElement("label");
      label.className = "gift-popup__option-label";
      label.textContent = option.name;
      label.setAttribute("for", "gift-option-" + optionIndex);

      var select = document.createElement("select");
      select.className = "gift-popup__option-select";
      select.id = "gift-option-" + optionIndex;
      select.dataset.optionIndex = optionIndex;

      option.values.forEach(function (value) {
        var opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        if (value === selectedOptions[optionIndex]) opt.selected = true;
        select.appendChild(opt);
      });

      select.addEventListener("change", function () {
        selectedOptions[optionIndex] = select.value;
        updateForSelectedVariant();
      });

      wrapper.appendChild(label);
      wrapper.appendChild(select);
      optionsEl.appendChild(wrapper);
    });
  }

  /**
   * Updates price/image/button state to reflect whichever variant
   * is currently selected (or shows "unavailable" if that exact
   * combination doesn't exist as a variant).
   */
  function updateForSelectedVariant() {
    var variant = getSelectedVariant();

    if (variant) {
      priceEl.textContent = formatMoney(variant.price);
      if (variant.featured_image && variant.featured_image.src) {
        imageEl.src = variant.featured_image.src;
      }
      addToCartBtn.disabled = !variant.available;
      addToCartBtn.textContent = variant.available ? "Add to Cart" : "Sold Out";
      addToCartBtn.dataset.variantId = variant.id;
    } else {
      addToCartBtn.disabled = true;
      addToCartBtn.textContent = "Unavailable";
      delete addToCartBtn.dataset.variantId;
    }

    feedbackEl.textContent = "";
  }

  /**
   * Fetches a product by handle and opens the popup populated with
   * its data.
   */
  function openPopupForHandle(handle) {
    fetch("/products/" + handle + ".js")
      .then(function (response) {
        if (!response.ok) throw new Error("Product request failed");
        return response.json();
      })
      .then(function (product) {
        currentProduct = product;

        // Default selection = the first available variant's options,
        // falling back to the very first variant.
        var defaultVariant =
          product.variants.find(function (v) {
            return v.available;
          }) || product.variants[0];
        selectedOptions = defaultVariant ? defaultVariant.options.slice() : [];

        titleEl.textContent = product.title;
        descriptionEl.innerHTML = product.description;
        imageEl.src = product.featured_image;
        imageEl.alt = product.title;

        renderOptions(product);
        updateForSelectedVariant();

        popup.hidden = false;
        document.body.style.overflow = "hidden"; // prevent background scroll
      })
      .catch(function (error) {
        console.error("Gift Guide: could not load product", error);
      });
  }

  function closePopup() {
    popup.hidden = true;
    document.body.style.overflow = "";
    currentProduct = null;
    selectedOptions = [];
  }

  /**
   * Adds the currently selected variant to the cart via Shopify's
   * AJAX Cart API, then gives the user visible feedback.
   */
  function addSelectedVariantToCart() {
    var variantId = addToCartBtn.dataset.variantId;
    if (!variantId) return;

    addToCartBtn.disabled = true;
    feedbackEl.textContent = "Adding…";

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: variantId, quantity: 1 }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Add to cart failed");
        return response.json();
      })
      .then(function () {
        feedbackEl.textContent = "Added to cart!";

        // Horizon's header cart icon is built with internal web
        // components and doesn't expose a standalone renderable
        // section the way Dawn-based themes do, so we can't patch its
        // count via the Sections Rendering API. The reliable,
        // theme-agnostic fix is a short delay (so the shopper sees the
        // confirmation message) followed by reloading the page, which
        // guarantees the header cart count is correct.
        setTimeout(function () {
          window.location.reload();
        }, 700);
      })
      .catch(function (error) {
        console.error("Gift Guide: add to cart failed", error);
        feedbackEl.textContent = "Something went wrong. Please try again.";
      })
      .finally(function () {
        addToCartBtn.disabled = false;
      });
  }

  // Event delegation: catches clicks on any hotspot, even ones added later.
  document.addEventListener("click", function (event) {
    var hotspot = event.target.closest("[data-gift-hotspot]");
    if (hotspot) {
      openPopupForHandle(hotspot.dataset.productHandle);
    }
  });

  overlayCloseEls.forEach(function (el) {
    el.addEventListener("click", closePopup);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !popup.hidden) closePopup();
  });

  addToCartBtn.addEventListener("click", addSelectedVariantToCart);
})();
