// Shopping cart for the shippable laser-engraving goods.
// Cart state lives in localStorage; checkout hands off to Stripe via the
// LonestarShopApp backend, which is the only part of this that isn't a
// plain static file. Update SHOP_API_URL once that service is deployed
// (see LonestarShopApp/README.md).
const SHOP_API_URL = "https://shop-api.lonestarbuckeyes.com";

const CART_KEY = "lbw_cart"; // { [productId]: { qty, customization, stain } }
// customization is null, or { type: "text", text, font } for engraving text,
// or { type: "logo", fileName, ref } for an uploaded logo (the actual file
// goes to the owner via Formspree at add-to-cart time - see
// submitLogoCustomization() - localStorage can't hold a File object, and
// wouldn't survive a page reload even if it could).
// stain is null, or { color } for a furniture item's optional stain finish
// upcharge (see stainOption/stainUpcharge on the product in products.js) -
// the upcharge amount itself is never stored here, only looked up live from
// the product, so it can never drift from what's actually charged.

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY)) || {};
    // Normalize old-format entries (plain qty numbers, from before
    // per-item customization existed) so a stale cart doesn't break.
    const cart = {};
    Object.keys(raw).forEach(id => {
      const entry = raw[id];
      cart[id] = typeof entry === "number" ? { qty: entry, customization: null } : entry;
    });
    return cart;
  } catch (e) {
    return {};
  }
}

function setCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderBadge();
  renderDrawerItems();
  renderCartPage();
}

function findProduct(id) {
  return (typeof PRODUCTS !== "undefined" ? PRODUCTS : []).find(p => p.id === id);
}

// Every item currently in the cart shares one fulfillment type ("ships" or
// "pickup") - addToCart() below enforces that. Returns null for an empty
// cart (either type is still allowed).
function cartFulfillment() {
  const lines = cartLines();
  return lines.length ? lines[0].product.fulfillment : null;
}

// The actual cart mutation, with no gating - only called once the
// fulfillment-mixing check (and, for pickup items, the ZIP check) has
// already passed. `customization`/`stain`, when given, replace whatever was
// previously stored for this line (the customer's latest submission wins) -
// qty always accumulates.
function commitAddToCart(id, qty, customization, stain) {
  const cart = getCart();
  const existing = cart[id] || { qty: 0, customization: null, stain: null };
  cart[id] = {
    qty: existing.qty + qty,
    customization: customization !== undefined ? customization : existing.customization,
    stain: stain !== undefined ? stain : existing.stain
  };
  setCart(cart);
  openDrawer();
}

// Public entry point every "Add to Cart" control calls. Ships and local
// pickup items can't share an order (Stripe Checkout can't apply
// shipping to one line item and not another), so this blocks mixing them,
// and requires a verified nearby ZIP before a pickup-only item can be
// added at all. Returns true if the item was added immediately, false if
// it was blocked or deferred to the ZIP modal.
function addToCart(id, qty = 1, customization, stain) {
  const product = findProduct(id);
  if (!product) return false;

  const existingFulfillment = cartFulfillment();
  if (existingFulfillment && existingFulfillment !== product.fulfillment) {
    const currentLabel = existingFulfillment === "pickup" ? "local-pickup" : "shippable";
    const newLabel = product.fulfillment === "pickup" ? "local-pickup" : "shippable";
    alert(
      `Your cart already has ${currentLabel} items in it. Shippable and local-pickup items ` +
      `can't be ordered together — please check out or clear your cart before adding a ${newLabel} item.`
    );
    return false;
  }

  if (product.fulfillment !== "pickup") {
    commitAddToCart(id, qty, customization, stain);
    return true;
  }

  const cached = getCachedPickupZip();
  if (cached && cached.eligible) {
    commitAddToCart(id, qty, customization, stain);
    return true;
  }

  openZipModal(id, qty);
  return false; // added later (if eligible) once the ZIP modal resolves
}

function setQty(id, qty) {
  const cart = getCart();
  if (qty <= 0) {
    delete cart[id];
  } else {
    const existing = cart[id] || { qty: 0, customization: null, stain: null };
    cart[id] = { qty, customization: existing.customization, stain: existing.stain };
  }
  setCart(cart);
}

function removeFromCart(id) {
  const cart = getCart();
  delete cart[id];
  setCart(cart);
}

// Per-unit price for `qty` of `product`, honoring bulk-quantity tiers if
// the product has any (currently the bottle opener - see tieredPricing in
// products.js). Falls back to the flat `price` otherwise. Mirrors
// tier_price() in LonestarShopApp/app.py, which is what actually decides
// the charge - this is purely for on-page price display.
function tierUnitPrice(product, qty) {
  const tiers = product.tieredPricing;
  if (!tiers || !tiers.length) return product.price;
  let unitPrice = tiers[0].price;
  tiers.forEach(tier => {
    if (qty >= tier.minQty) unitPrice = tier.price;
  });
  return unitPrice;
}

// Stain upcharge for a line, looked up live from the product (never from
// what's stored in the cart entry) so it can never drift from what's
// actually charged - mirrors tier_price()'s "recompute, don't trust" pattern.
function lineStainUpcharge(product, stain) {
  return stain ? (product.stainUpcharge || 0) : 0;
}

function cartLines() {
  const cart = getCart();
  return Object.keys(cart)
    .map(id => {
      const product = findProduct(id);
      if (!product) return null;
      const { qty, customization, stain } = cart[id];
      const unitPrice = tierUnitPrice(product, qty) + lineStainUpcharge(product, stain);
      return { product, qty, unitPrice, lineTotal: unitPrice * qty, customization, stain: stain || null };
    })
    .filter(Boolean);
}

function cartCount() {
  const cart = getCart();
  return Object.values(cart).reduce((sum, entry) => sum + entry.qty, 0);
}

function cartSubtotal() {
  return cartLines().reduce((sum, line) => sum + line.lineTotal, 0);
}

// --- Weight-based shipping estimate (ships-fulfillment carts only) --------

// A couple of flat-rate tiers based on total cart weight, replacing the old
// single flat rate - a bottle opener and a cutting board don't cost the
// same to actually mail. Mirrors WEIGHT_SHIPPING_TIERS in
// LonestarShopApp/app.py, which is what Stripe actually charges - this is
// purely for the live on-page estimate so customers aren't surprised at
// checkout. `maxOz` is inclusive; tiers must stay sorted ascending.
const SHIPPING_WEIGHT_TIERS = [
  { maxOz: 16, cents: 799 },       // up to 1 lb
  { maxOz: Infinity, cents: 1399 } // over 1 lb
];

// Total shipping weight of every "ships" line in the cart (pickup items
// don't ship, so they're excluded - a cart can't mix the two anyway, but
// this stays safe even if that ever changes).
function cartShipWeightOz() {
  return cartLines()
    .filter(line => line.product.fulfillment === "ships")
    .reduce((sum, line) => sum + (line.product.shipWeightOz || 0) * line.qty, 0);
}

function estimatedShippingCents() {
  const totalOz = cartShipWeightOz();
  const tier = SHIPPING_WEIGHT_TIERS.find(t => totalOz <= t.maxOz);
  return tier ? tier.cents : SHIPPING_WEIGHT_TIERS[SHIPPING_WEIGHT_TIERS.length - 1].cents;
}

function renderBadge() {
  document.querySelectorAll(".cart-badge").forEach(el => {
    el.textContent = cartCount();
  });
}

// --- Engraving customization (text/font or logo upload) -------------------

// Logo files are emailed to the owner via the LonestarShopApp backend
// (which sends via Gmail SMTP, same pattern as LonestarAdminApp) - Stripe
// Checkout can't carry attachments, so this has to happen at add-to-cart
// time instead. Originally used Formspree (the same form the contact page
// posts to), but Formspree's free plan turned out to reject file
// attachments outright ("File Uploads Not Permitted") - discovered
// 2026-08-25 via a real customer report after launch, not caught during
// development since testing used a mocked fetch to avoid emailing test
// junk to the owner's inbox before they knew about the feature. Text
// engraving needs no upload at all: it's cheap enough to pass straight
// through to the Checkout line item description, so it skips this
// entirely - see startCheckout().

// Font choices are a preference label relayed to the owner for the actual
// engraving, not a live render of the real laser font - inline styling on
// the <option> is just a rough visual hint using common system fonts.
const FONT_OPTIONS = [
  { value: "Classic Serif", family: "Georgia, 'Times New Roman', serif" },
  { value: "Modern Sans", family: "Arial, Helvetica, sans-serif" },
  { value: "Script / Cursive", family: "'Brush Script MT', cursive" },
  { value: "Bold Block", family: "Impact, 'Arial Black', sans-serif" },
  { value: "Elegant Serif", family: "'Times New Roman', serif" }
];

function generateRefCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Mirrors MAX_LOGO_BYTES in LonestarShopApp/app.py - checked client-side
// too so an oversized file fails fast instead of only after an upload
// attempt.
const LOGO_MAX_BYTES = 10 * 1024 * 1024;

// --- Stain finish add-on (porch swings) ------------------------------------

// Curated subset of Varathane's most common wood stain shades - the ones
// regularly stocked on the shelf at Home Depot/Lowes rather than their full
// custom-tint catalog (200+ shades via the in-store paint desk). Sourced
// from Varathane's Premium Wood Stain / Premium Fast Dry Wood Stain lines.
const STAIN_COLORS = [
  "Natural",
  "Golden Oak",
  "Early American",
  "Gunstock",
  "American Walnut",
  "Dark Walnut",
  "Kona",
  "Espresso",
  "Ebony",
  "Weathered Gray",
  "Carbon Gray",
  "Red Mahogany"
];

function stainPanelHTML(product) {
  const colorOptions = STAIN_COLORS.map(c => `<option value="${c}">${c}</option>`).join("");
  return `
    <div class="stain-panel" data-stain-for="${product.id}">
      <label class="stain-toggle">
        <input type="checkbox" class="stain-checkbox">
        Add a stain finish (+${money(product.stainUpcharge)})
      </label>
      <div class="stain-color-fields" hidden>
        <label class="customize-label">Stain color</label>
        <select class="stain-color-select">${colorOptions}</select>
        <p class="note">Varathane wood stain. Actual shade can vary slightly with wood grain — we'll confirm before finishing.</p>
      </div>
    </div>
  `;
}

// Wires the checkbox/color select and attaches getStain() onto the panel
// itself. No validate() needed here (unlike the engraving panel) - the
// color select always has a valid default, so checking the box is always
// enough to produce a complete selection.
function wireStainPanel(panel, product) {
  const checkbox = panel.querySelector(".stain-checkbox");
  const colorFields = panel.querySelector(".stain-color-fields");
  const colorSelect = panel.querySelector(".stain-color-select");

  checkbox.addEventListener("change", () => {
    colorFields.hidden = !checkbox.checked;
  });

  panel.getStain = function () {
    return checkbox.checked ? { color: colorSelect.value } : null;
  };
}

// Uploads a logo file to the owner via the LonestarShopApp backend, which
// emails it (see send_logo_email() in app.py). Returns a short reference
// code included in both the email subject and the Stripe line item, so the
// owner can match a paid order to the emailed design.
async function submitLogoCustomization(product, qty, file, text, font) {
  const ref = generateRefCode();
  const formData = new FormData();
  formData.append("product", product.name);
  formData.append("quantity", String(qty));
  formData.append("reference", ref);
  formData.append("logo", file);
  if (text) {
    formData.append("text_note", `${text}${font ? ` (${font})` : ""}`);
  }

  let res;
  try {
    res = await fetch(`${SHOP_API_URL}/api/upload-logo`, { method: "POST", body: formData });
  } catch (e) {
    throw new Error("Upload failed - please try again or email it to us directly.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error((data && data.error) || "Upload failed - please try again or email it to us directly.");
  }
  return ref;
}

function customizationSummary(customization) {
  if (!customization) return "";
  const parts = [];
  if (customization.text) {
    parts.push(`"${customization.text}" — ${customization.font}`);
  }
  if (customization.logoFileName) {
    parts.push(`logo uploaded (${customization.logoFileName}, ref ${customization.logoRef})`);
  }
  return parts.length ? `Engraving: ${parts.join(" + ")}` : "";
}

function customizationPanelHTML(product) {
  const fontOptions = FONT_OPTIONS
    .map(f => `<option value="${f.value}" style="font-family:${f.family}">${f.value}</option>`)
    .join("");
  return `
    <div class="customize-panel" data-customize-for="${product.id}">
      <label class="customize-label">Personalize this item <span class="required-mark">*</span></label>
      <div class="customize-text-fields">
        <input type="text" class="customize-text-input" maxlength="40" placeholder="Text to engrave (e.g. a name or short quote)">
        <select class="customize-font-select">${fontOptions}</select>
      </div>
      <div class="customize-logo-fields">
        <input type="file" class="customize-logo-input" accept="image/png,image/jpeg,image/svg+xml,application/pdf">
        <p class="note">Optional logo: PNG, JPG, SVG or PDF, up to 10MB. Add text and/or a logo — we'll confirm the final engraving look with you before production.</p>
      </div>
      <p class="customize-error" hidden></p>
    </div>
  `;
}

// Wires the fields and attaches getCustomization()/validate() onto the panel
// element itself, so any add-to-cart handler in the same card can just call
// panel.validate() / panel.getCustomization() without needing to know the
// panel's internal DOM structure. Text and logo are independent fields, not
// mutually exclusive - a customer can supply either or both.
function wireCustomizationPanel(panel) {
  const textInput = panel.querySelector(".customize-text-input");
  const fontSelect = panel.querySelector(".customize-font-select");
  const logoInput = panel.querySelector(".customize-logo-input");
  const errorEl = panel.querySelector(".customize-error");

  [textInput, logoInput].forEach(el => {
    el.addEventListener("input", () => { errorEl.hidden = true; });
  });

  panel.getCustomization = function () {
    return {
      text: textInput.value.trim(),
      font: fontSelect.value,
      file: logoInput.files[0] || null
    };
  };

  panel.validate = function () {
    const c = panel.getCustomization();
    if (!c.text && !c.file) {
      errorEl.textContent = "Please enter text to engrave and/or upload a logo.";
      errorEl.hidden = false;
      return false;
    }
    if (c.file && c.file.size > LOGO_MAX_BYTES) {
      errorEl.textContent = `That file is too large - please keep logos under ${LOGO_MAX_BYTES / (1024 * 1024)}MB.`;
      errorEl.hidden = false;
      return false;
    }
    errorEl.hidden = true;
    return true;
  };
}

// Shared by every "Add to Cart" trigger on a customizable product. Text-only
// customization commits immediately (nothing to upload); a logo (with or
// without accompanying text) disables the button while it sends the file to
// the owner via the LonestarShopApp backend, then commits only once that
// succeeds - so a failed upload never results in an order the owner has no
// design for.
async function addCustomizedToCart(id, qty, panel, btn) {
  if (!panel.validate()) return;
  const c = panel.getCustomization();
  const product = findProduct(id);
  const original = btn.textContent;

  if (c.file) {
    btn.disabled = true;
    btn.textContent = "Uploading design...";
    try {
      const ref = await submitLogoCustomization(product, qty, c.file, c.text, c.font);
      const added = addToCart(id, qty, {
        text: c.text || null,
        font: c.text ? c.font : null,
        logoFileName: c.file.name,
        logoRef: ref
      });
      btn.disabled = false;
      btn.textContent = added ? "Added!" : original;
      if (added) setTimeout(() => { btn.textContent = original; }, 1200);
    } catch (err) {
      alert(`Sorry, we couldn't upload your logo: ${err.message}`);
      btn.disabled = false;
      btn.textContent = original;
    }
    return;
  }

  const added = addToCart(id, qty, { text: c.text, font: c.font, logoFileName: null, logoRef: null });
  if (added) {
    btn.textContent = "Added!";
    setTimeout(() => { btn.textContent = original; }, 1200);
  }
}

// --- Drawer (injected once, available on every page) ------------------

function buildDrawer() {
  if (document.getElementById("cart-drawer")) return;

  const overlay = document.createElement("div");
  overlay.id = "cart-overlay";
  overlay.className = "cart-overlay";

  const drawer = document.createElement("aside");
  drawer.id = "cart-drawer";
  drawer.className = "cart-drawer";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="cart-drawer-head">
      <h3>Your Cart</h3>
      <button id="cart-close" class="cart-close" aria-label="Close cart">&times;</button>
    </div>
    <div id="cart-drawer-items" class="cart-drawer-items"></div>
    <div class="cart-drawer-footer">
      <div class="cart-subtotal-row"><span>Subtotal</span><strong id="cart-drawer-subtotal">$0.00</strong></div>
      <a href="cart.html" class="btn btn-secondary cart-view-btn">View Cart</a>
      <button id="cart-drawer-checkout" class="btn btn-primary cart-checkout-btn" type="button">Checkout</button>
      <p class="cart-note" data-fulfillment-note></p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  overlay.addEventListener("click", closeDrawer);
  drawer.querySelector("#cart-close").addEventListener("click", closeDrawer);
  drawer.querySelector("#cart-drawer-checkout").addEventListener("click", startCheckout);
}

function openDrawer() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (!drawer || !overlay) return;
  drawer.classList.add("is-open");
  overlay.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  if (!drawer || !overlay) return;
  drawer.classList.remove("is-open");
  overlay.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

// --- Pickup ZIP gate (modal + verified-ZIP cache) --------------------------

const PICKUP_ZIP_KEY = "lbw_pickup_zip"; // { zip, eligible, distance_miles, radius_miles }
let pendingPickupAdd = null; // { id, qty } while the modal is open for an add-to-cart flow

function getCachedPickupZip() {
  try {
    return JSON.parse(localStorage.getItem(PICKUP_ZIP_KEY));
  } catch (e) {
    return null;
  }
}

function setCachedPickupZip(data) {
  localStorage.setItem(PICKUP_ZIP_KEY, JSON.stringify(data));
}

async function checkPickupZip(zip) {
  const res = await fetch(`${SHOP_API_URL}/api/check-pickup-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zip })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not check that ZIP code.");
  return data; // { eligible, distance_miles, radius_miles }
}

function buildZipModal() {
  if (document.getElementById("zip-modal")) return;

  const overlay = document.createElement("div");
  overlay.id = "zip-modal-overlay";
  overlay.className = "cart-overlay";

  const modal = document.createElement("div");
  modal.id = "zip-modal";
  modal.className = "zip-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <div class="zip-modal-box">
      <button type="button" id="zip-modal-close" class="cart-close" aria-label="Close">&times;</button>
      <h3>Check local pickup availability</h3>
      <p>This item is local pickup only near McKinney, TX. Enter your ZIP code to confirm you're within our 50-mile pickup area.</p>
      <div class="zip-modal-row">
        <input type="text" id="zip-modal-input" inputmode="numeric" maxlength="5" placeholder="ZIP code">
        <button type="button" id="zip-modal-submit" class="btn btn-primary">Check</button>
      </div>
      <p id="zip-modal-message" class="zip-modal-message"></p>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  overlay.addEventListener("click", closeZipModal);
  modal.querySelector("#zip-modal-close").addEventListener("click", closeZipModal);
  modal.querySelector("#zip-modal-submit").addEventListener("click", submitZipModal);
  modal.querySelector("#zip-modal-input").addEventListener("keydown", e => {
    if (e.key === "Enter") submitZipModal();
  });
}

function openZipModal(id, qty) {
  pendingPickupAdd = id ? { id, qty } : null;
  const modal = document.getElementById("zip-modal");
  const overlay = document.getElementById("zip-modal-overlay");
  const input = document.getElementById("zip-modal-input");
  const message = document.getElementById("zip-modal-message");
  message.textContent = "";
  message.className = "zip-modal-message";
  input.value = "";
  modal.classList.add("is-open");
  overlay.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  input.focus();
}

function closeZipModal() {
  const modal = document.getElementById("zip-modal");
  const overlay = document.getElementById("zip-modal-overlay");
  if (!modal || !overlay) return;
  modal.classList.remove("is-open");
  overlay.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  pendingPickupAdd = null;
}

async function submitZipModal() {
  const input = document.getElementById("zip-modal-input");
  const message = document.getElementById("zip-modal-message");
  const submitBtn = document.getElementById("zip-modal-submit");
  const zip = input.value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking...";
  message.textContent = "";
  message.className = "zip-modal-message";

  try {
    const result = await checkPickupZip(zip);
    setCachedPickupZip({ zip, ...result });
    if (result.eligible) {
      message.className = "zip-modal-message is-success";
      message.textContent = `You're about ${result.distance_miles} miles away — local pickup is available.`;
      if (pendingPickupAdd) commitAddToCart(pendingPickupAdd.id, pendingPickupAdd.qty);
      renderFulfillmentNotices();
      setTimeout(closeZipModal, 900);
    } else {
      message.className = "zip-modal-message is-error";
      message.innerHTML = `That ZIP is about ${result.distance_miles} miles from our North Texas shop — outside our ${result.radius_miles}-mile pickup range. <a href="contact.html">Contact us</a> to discuss options.`;
    }
  } catch (err) {
    message.className = "zip-modal-message is-error";
    message.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Check";
  }
}

function productThumb(product) {
  return product.image || (product.images && product.images[0]) || "";
}

function cartLineRow(line, { compact }) {
  const { product, qty, unitPrice, lineTotal, customization, stain } = line;
  const customText = customizationSummary(customization);
  const stainText = stain ? `Stain: ${stain.color} (+${money(product.stainUpcharge || 0)})` : "";
  return `
    <div class="cart-line" data-id="${product.id}">
      <img src="${productThumb(product)}" alt="${product.name}">
      <div class="cart-line-body">
        <strong>${product.name}</strong>
        <span class="cart-line-price">
          ${money(unitPrice)} each
          <span class="fulfillment-tag fulfillment-${product.fulfillment}">${product.fulfillment === "pickup" ? "Local Pickup" : "Ships"}</span>
        </span>
        ${customText ? `<span class="cart-line-custom">${customText}</span>` : ""}
        ${stainText ? `<span class="cart-line-custom">${stainText}</span>` : ""}
        <div class="cart-qty">
          <button type="button" class="qty-btn" data-action="dec" aria-label="Decrease quantity">&minus;</button>
          <span class="qty-value">${qty}</span>
          <button type="button" class="qty-btn" data-action="inc" aria-label="Increase quantity">&plus;</button>
          ${compact ? "" : `<button type="button" class="qty-remove" data-action="remove">Remove</button>`}
        </div>
      </div>
      <div class="cart-line-total">${money(lineTotal)}</div>
    </div>
  `;
}

function wireLineButtons(container) {
  container.querySelectorAll(".cart-line").forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const cart = getCart();
        const currentQty = (cart[id] && cart[id].qty) || 0;
        if (action === "inc") setQty(id, currentQty + 1);
        if (action === "dec") setQty(id, currentQty - 1);
        if (action === "remove") removeFromCart(id);
      });
    });
  });
}

// Updates the fulfillment note in the drawer footer and on the full cart
// page - explains ships vs. pickup, and for a pickup cart shows the
// verified ZIP with a link to re-check a different one.
function fulfillmentNoticeHTML() {
  const fulfillment = cartFulfillment();
  if (fulfillment === "pickup") {
    const cached = getCachedPickupZip();
    const zipBit = cached
      ? ` Verified for ZIP ${cached.zip} — <button type="button" class="zip-change-link" data-change-zip>not your ZIP?</button>`
      : "";
    return `Local pickup only, North Texas.${zipBit}`;
  }
  if (fulfillment === "ships") {
    return `Ships nationwide. Estimated shipping: ${money(estimatedShippingCents())} (added at checkout).`;
  }
  return `Shippable items ship nationwide. Furniture &amp; outdoor pieces are local pickup only (North Texas) — the two can't be combined in one order.`;
}

function renderFulfillmentNotices() {
  document.querySelectorAll("[data-fulfillment-note]").forEach(el => {
    el.innerHTML = fulfillmentNoticeHTML();
    const changeBtn = el.querySelector("[data-change-zip]");
    if (changeBtn) changeBtn.addEventListener("click", () => openZipModal());
  });
}

function renderDrawerItems() {
  const container = document.getElementById("cart-drawer-items");
  const subtotalEl = document.getElementById("cart-drawer-subtotal");
  if (!container || !subtotalEl) return;

  const lines = cartLines();
  container.innerHTML = lines.length
    ? lines.map(line => cartLineRow(line, { compact: true })).join("")
    : `<p class="cart-empty">Your cart is empty.</p>`;
  subtotalEl.textContent = money(cartSubtotal());
  wireLineButtons(container);
  renderFulfillmentNotices();
}

// --- Full cart page (cart.html) -----------------------------------------

function renderCartPage() {
  const container = document.getElementById("cart-page-items");
  const subtotalEl = document.getElementById("cart-page-subtotal");
  const checkoutBtn = document.getElementById("cart-page-checkout");
  if (!container || !subtotalEl) return;

  const lines = cartLines();
  container.innerHTML = lines.length
    ? lines.map(line => cartLineRow(line, { compact: false })).join("")
    : `<p class="cart-empty">Your cart is empty. <a href="shop.html">Browse the shop</a>.</p>`;
  subtotalEl.textContent = money(cartSubtotal());
  if (checkoutBtn) checkoutBtn.disabled = lines.length === 0;
  wireLineButtons(container);
  renderFulfillmentNotices();
}

// --- Checkout -------------------------------------------------------------

async function startCheckout() {
  const lines = cartLines();
  if (!lines.length) return;

  const fulfillment = cartFulfillment();
  const cachedZip = getCachedPickupZip();

  const checkoutButtons = document.querySelectorAll("#cart-drawer-checkout, #cart-page-checkout");
  checkoutButtons.forEach(btn => { btn.disabled = true; btn.textContent = "Redirecting..."; });

  try {
    const body = {
      items: lines.map(line => ({
        id: line.product.id,
        qty: line.qty,
        customization: line.customization || null,
        stain: line.stain || null
      }))
    };
    if (fulfillment === "pickup" && cachedZip) {
      body.zip = cachedZip.zip;
    }
    const res = await fetch(`${SHOP_API_URL}/api/create-checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error || "Could not start checkout.");
    }
    window.location.href = data.url;
  } catch (err) {
    alert(`Sorry, checkout couldn't start: ${err.message}`);
    checkoutButtons.forEach(btn => { btn.disabled = false; btn.textContent = "Checkout"; });
  }
}

// --- Product grid: grouped variants, image carousel, add-to-cart ----------

// Most products are a single flat card. A few (currently the slate
// coasters) are modeled as multiple PRODUCTS entries sharing a
// `variantGroup` id — e.g. "coaster-slate-round" and "coaster-slate-square"
// - so they render as one card with a shape toggle, but each variant keeps
// its own real product id/name so the cart and Stripe both know exactly
// which shape was ordered.
function groupProductsForDisplay() {
  const groups = [];
  const byKey = new Map();
  // hiddenFromGrid entries (e.g. each individual cedar planter size) are
  // real, separately-priced PRODUCTS so the cart/Stripe can tell them
  // apart, but they don't get their own card - only the display entry that
  // lists them via `sizeOptions` does.
  (typeof PRODUCTS !== "undefined" ? PRODUCTS : []).filter(p => !p.hiddenFromGrid).forEach(p => {
    const key = p.variantGroup || p.id;
    if (!byKey.has(key)) {
      const group = { key, variants: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).variants.push(p);
  });
  return groups;
}

// Renders an image carousel into `container` for the given image list.
// Single-image products just get a plain image (nav/dots only render when
// there's more than one photo).
function renderCarousel(container, images, name = "") {
  const safeImages = images && images.length ? images : [""];
  container.innerHTML = `
    <div class="carousel-viewport">
      ${safeImages.map((src, i) => `<img src="${src}" class="carousel-slide${i === 0 ? " is-active" : ""}" alt="${name}${i > 0 ? ` — photo ${i + 1}` : ""}">`).join("")}
    </div>
    ${safeImages.length > 1 ? `
      <button type="button" class="carousel-nav carousel-prev" aria-label="Previous photo">&#8249;</button>
      <button type="button" class="carousel-nav carousel-next" aria-label="Next photo">&#8250;</button>
      <div class="carousel-dots">${safeImages.map((_, i) => `<span class="carousel-dot${i === 0 ? " is-active" : ""}" data-dot="${i}"></span>`).join("")}</div>
    ` : ""}
  `;
  if (safeImages.length <= 1) return;

  let index = 0;
  const slides = container.querySelectorAll(".carousel-slide");
  const dots = container.querySelectorAll(".carousel-dot");
  function show(i) {
    index = (i + safeImages.length) % safeImages.length;
    slides.forEach((s, si) => s.classList.toggle("is-active", si === index));
    dots.forEach((d, di) => d.classList.toggle("is-active", di === index));
  }
  container.querySelector(".carousel-prev").addEventListener("click", () => show(index - 1));
  container.querySelector(".carousel-next").addEventListener("click", () => show(index + 1));
  dots.forEach(dot => dot.addEventListener("click", () => show(parseInt(dot.dataset.dot, 10))));
}

// For products sold in preset set sizes at a linear per-unit price
// (currently the coasters) — a dropdown of "Set of N" choices plus a
// "Custom Quantity" option that reveals a qty field, matching the same
// dropdown pattern used for the cedar planter's size picker. Unlike the
// planter's custom size, a custom *quantity* here still has a knowable
// price (unit price × qty), so it keeps a real Add to Cart button instead
// of falling back to a quote request.
function presetQtyPickerHTML(product) {
  const options = product.presetSets
    .map(n => `<option value="${n}">Set of ${n} — ${money(product.price * n)}</option>`)
    .join("");
  return `
    <div class="qty-picker">
      <label for="qty-select-${product.id}">Quantity</label>
      <select id="qty-select-${product.id}" class="qty-select">
        ${options}
        <option value="__custom">Custom Quantity</option>
      </select>
      <div class="custom-qty-fields" hidden>
        <label for="qty-custom-${product.id}">How many?</label>
        <input type="number" id="qty-custom-${product.id}" class="qty-custom-input" min="1" step="1" value="${product.presetSets[0]}">
      </div>
    </div>
    <div class="qty-picker-action"></div>
  `;
}

function wirePresetQtyPicker(controlsEl, product) {
  const select = controlsEl.querySelector(".qty-select");
  const customFields = controlsEl.querySelector(".custom-qty-fields");
  const customInput = controlsEl.querySelector(".qty-custom-input");
  const actionEl = controlsEl.querySelector(".qty-picker-action");

  function currentQty() {
    if (select.value === "__custom") return Math.max(1, parseInt(customInput.value, 10) || 1);
    return parseInt(select.value, 10);
  }

  function renderAction() {
    customFields.hidden = select.value !== "__custom";
    const qty = currentQty();
    actionEl.innerHTML = `<button type="button" class="btn btn-primary add-to-cart-btn" data-add-to-cart>Add to Cart — ${money(product.price * qty)}</button>`;
    const btn = actionEl.querySelector("[data-add-to-cart]");
    if (product.customizable) {
      const panel = controlsEl.closest("article.product").querySelector(".customize-panel");
      btn.addEventListener("click", () => addCustomizedToCart(product.id, currentQty(), panel, btn));
    } else {
      btn.addEventListener("click", () => addToCart(product.id, currentQty()));
    }
  }

  select.addEventListener("change", renderAction);
  customInput.addEventListener("input", renderAction);
  renderAction();
}

// For products sold in a fixed set of sizes at different prices (currently
// the cedar planters) rather than a linear per-unit quantity. Renders a
// <select> of the standard sizes plus a "Custom Size" option; picking a
// standard size shows a normal Add to Cart button at that size's real
// price (looked up via findProduct, never trusted from this list), while
// "Custom Size" reveals L/W/H fields and swaps the action to a quote
// request instead of a cart add, since an arbitrary custom size doesn't
// have a knowable price to charge.
function sizePickerHTML(product) {
  const options = product.sizeOptions
    .map(o => {
      const p = findProduct(o.id);
      return `<option value="${o.id}">${o.label} — ${money(p.price)}</option>`;
    })
    .join("");
  return `
    <div class="size-picker">
      <label for="size-select-${product.id}">Size</label>
      <select id="size-select-${product.id}" class="size-select">
        ${options}
        <option value="__custom">Custom Size (request a quote)</option>
      </select>
      <div class="custom-size-fields" hidden>
        <p class="note">Custom sizes are built to order — enter the dimensions you'd like, then send a quote request.</p>
        <div class="custom-size-row">
          <input type="number" min="1" class="custom-size-input" data-dim="length" placeholder="Length (in)">
          <input type="number" min="1" class="custom-size-input" data-dim="width" placeholder="Width (in)">
          <input type="number" min="1" class="custom-size-input" data-dim="height" placeholder="Height (in)">
        </div>
      </div>
    </div>
    <div class="size-picker-action"></div>
  `;
}

function wireSizePicker(controlsEl, product) {
  const select = controlsEl.querySelector(".size-select");
  const customFields = controlsEl.querySelector(".custom-size-fields");
  const actionEl = controlsEl.querySelector(".size-picker-action");

  function renderAction() {
    if (select.value === "__custom") {
      customFields.hidden = false;
      actionEl.innerHTML = `<a href="contact.html" class="btn btn-secondary buy-now-link" style="width:100%">Request a Quote</a>`;
    } else {
      customFields.hidden = true;
      const opt = findProduct(select.value);
      actionEl.innerHTML = `<button type="button" class="btn btn-primary add-to-cart-btn" data-add-to-cart="${opt.id}">Add to Cart — ${money(opt.price)}</button>`;
      wireSimpleAddButton(actionEl.querySelector("[data-add-to-cart]"), opt);
    }
  }

  select.addEventListener("change", renderAction);
  renderAction();
}

// For products with bulk-quantity price breaks (currently the bottle
// opener). Unlike the coaster/planter pickers this is a free-typed
// quantity, not a fixed set of choices, so it's a plain number input with
// a live unit-price/total preview plus a reference table of the upcoming
// breakpoints, driven by the same tierUnitPrice() used for cart lines.
function tieredQtyPickerHTML(product) {
  const tiers = product.tieredPricing;
  const breaksHTML = tiers
    .slice(1) // the first tier is just the base price, already shown above
    .map(t => `<li>${t.minQty}+ — ${money(t.price)} each</li>`)
    .join("");
  return `
    <div class="tiered-picker">
      <label for="tiered-qty-${product.id}">Quantity</label>
      <input type="number" id="tiered-qty-${product.id}" min="1" step="1" value="1" class="tiered-qty-input">
      <div class="tiered-price-line">
        <span class="tiered-unit-price"></span>
        <span class="tiered-total"></span>
      </div>
      ${breaksHTML ? `<ul class="tiered-breaks">${breaksHTML}</ul>` : ""}
    </div>
    <div class="tiered-picker-action"></div>
  `;
}

function wireTieredQtyPicker(controlsEl, product) {
  const input = controlsEl.querySelector(".tiered-qty-input");
  const unitPriceEl = controlsEl.querySelector(".tiered-unit-price");
  const totalEl = controlsEl.querySelector(".tiered-total");
  const actionEl = controlsEl.querySelector(".tiered-picker-action");

  function readQty() {
    return Math.max(1, parseInt(input.value, 10) || 1);
  }

  function render() {
    const qty = readQty();
    const unit = tierUnitPrice(product, qty);
    unitPriceEl.textContent = `${money(unit)} each`;
    totalEl.textContent = `Total: ${money(unit * qty)}`;
    actionEl.innerHTML = `<button type="button" class="btn btn-primary add-to-cart-btn" data-add-to-cart>Add to Cart</button>`;
    const btn = actionEl.querySelector("[data-add-to-cart]");
    if (product.customizable) {
      const panel = controlsEl.closest("article.product").querySelector(".customize-panel");
      btn.addEventListener("click", () => addCustomizedToCart(product.id, readQty(), panel, btn));
    } else {
      btn.addEventListener("click", () => addToCart(product.id, readQty()));
    }
  }

  input.addEventListener("input", render);
  render();
}

function flashAdded(btn) {
  const original = btn.textContent;
  btn.textContent = "Added!";
  setTimeout(() => { btn.textContent = original; }, 1200);
}

function wireSimpleAddButton(btn, product) {
  btn.addEventListener("click", () => {
    if (product.customizable) {
      const panel = btn.closest("article.product").querySelector(".customize-panel");
      addCustomizedToCart(product.id, 1, panel, btn);
      return;
    }
    if (product.stainOption) {
      const panel = btn.closest("article.product").querySelector(".stain-panel");
      const stain = panel.getStain();
      const added = addToCart(product.id, 1, undefined, stain);
      if (!added) return; // blocked (mixed cart) or deferred to the ZIP modal
      flashAdded(btn);
      return;
    }
    const added = addToCart(product.id, 1);
    if (!added) return; // blocked (mixed cart) or deferred to the ZIP modal
    flashAdded(btn);
  });
}

// Fills `controlsEl` with whichever picker `product` needs (size, preset
// quantity set, tiered quantity, or a plain Add to Cart button) and wires
// it up. Shared by buildProductCard() (the Shop/Home grid) and
// wireStaticProductCards() (the Furniture/Outdoor marketing pages) so
// every purchase path - including the pickup ZIP gate inside addToCart() -
// behaves identically no matter which page the button lives on.
function renderPurchaseControls(controlsEl, product) {
  if (product.sizeOptions) {
    controlsEl.innerHTML = sizePickerHTML(product);
    wireSizePicker(controlsEl, product);
  } else if (product.presetSets) {
    controlsEl.innerHTML = presetQtyPickerHTML(product);
    wirePresetQtyPicker(controlsEl, product);
  } else if (product.tieredPricing) {
    controlsEl.innerHTML = tieredQtyPickerHTML(product);
    wireTieredQtyPicker(controlsEl, product);
  } else {
    controlsEl.innerHTML = `<button type="button" class="btn btn-primary add-to-cart-btn" data-add-to-cart="${product.id}">Add to Cart</button>`;
    wireSimpleAddButton(controlsEl.querySelector("[data-add-to-cart]"), product);
  }
}

// Builds one product card, including a Round/Square-style toggle when the
// group has more than one variant.
function buildProductCard(article, group) {
  const variants = group.variants;
  const multi = variants.length > 1;
  const primary = variants[0];
  const displayName = multi ? primary.groupName : primary.name;
  const displayDescription = multi ? primary.groupDescription : primary.description;

  article.innerHTML = `
    <div class="product-carousel"></div>
    <div class="body">
      <span class="fulfillment-tag fulfillment-${primary.fulfillment}">${primary.fulfillment === "pickup" ? "Local Pickup Only" : "Ships Nationwide"}</span>
      <h3>${displayName}</h3>
      <p>${displayDescription}</p>
      ${multi ? `
        <div class="shape-toggle" role="group" aria-label="Shape">
          ${variants.map((v, i) => `<button type="button" class="shape-btn${i === 0 ? " is-active" : ""}" data-variant-id="${v.id}">${v.variantLabel}</button>`).join("")}
        </div>
      ` : ""}
      <div class="product-price">${
        primary.sizeOptions ? "From " + money(Math.min(...primary.sizeOptions.map(o => findProduct(o.id).price))) :
        primary.tieredPricing ? "From " + money(Math.min(...primary.tieredPricing.map(t => t.price))) + " each" :
        money(primary.price) + (primary.presetSets ? " each" : "")
      }</div>
      ${primary.customizable ? customizationPanelHTML(primary) : ""}
      ${primary.stainOption ? stainPanelHTML(primary) : ""}
      <div class="product-controls"></div>
    </div>
  `;

  const carouselEl = article.querySelector(".product-carousel");
  const controlsEl = article.querySelector(".product-controls");

  // Built once, outside .product-controls, so switching Round/Square (which
  // rebuilds .product-controls via setVariant below) never wipes out
  // whatever text/font, logo or stain choice the customer already entered.
  if (primary.customizable) {
    wireCustomizationPanel(article.querySelector(".customize-panel"));
  }
  if (primary.stainOption) {
    wireStainPanel(article.querySelector(".stain-panel"), primary);
  }

  function setVariant(variant) {
    renderCarousel(carouselEl, variant.images || [variant.image], variant.name);
    renderPurchaseControls(controlsEl, variant);
    article.querySelectorAll(".shape-btn").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.variantId === variant.id);
    });
  }

  if (multi) {
    article.querySelectorAll(".shape-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        setVariant(variants.find(v => v.id === btn.dataset.variantId));
      });
    });
  }

  setVariant(primary);
}

function renderGridInto(grid, groups) {
  if (!grid) return;
  // Each card gets an id from its product/group key (e.g. "product-garden-bench")
  // so other pages (furniture.html, outdoor.html) can deep-link a "Buy Now"
  // button straight to the matching shop card via shop.html#product-<id>.
  grid.innerHTML = groups.map(g => `<article class="product" id="product-${g.key}"></article>`).join("");
  const articles = grid.querySelectorAll("article.product");
  groups.forEach((group, i) => buildProductCard(articles[i], group));
}

// If the page loaded with a #product-<id> hash (e.g. a "Buy Now" link from
// furniture.html), scroll that card into view. Run after rendering, since
// the cards don't exist in the DOM yet when the browser normally tries to
// jump to a URL hash on page load.
function scrollToHashProduct() {
  if (!location.hash) return;
  const target = document.querySelector(location.hash);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

// shop.html splits products into two grids (Ships Nationwide / Local
// Pickup Only). Falls back to a single #shop-product-grid, in case any
// other page ever wants an unfiltered listing.
function renderProductGrid() {
  if (typeof PRODUCTS === "undefined") return;
  const groups = groupProductsForDisplay();
  const shipsGrid = document.getElementById("shop-product-grid-ships");
  const pickupGrid = document.getElementById("shop-product-grid-pickup");

  if (shipsGrid || pickupGrid) {
    renderGridInto(shipsGrid, groups.filter(g => g.variants[0].fulfillment === "ships"));
    renderGridInto(pickupGrid, groups.filter(g => g.variants[0].fulfillment === "pickup"));
    return;
  }
  renderGridInto(document.getElementById("shop-product-grid"), groups);
}

// Home page "Best Sellers" strip - real, fully-functional product cards
// (same buildProductCard() as the shop grid, so Add to Cart/stain/tiered
// pricing all work identically) for a curated id list, so a customer can
// buy a top item without ever navigating to shop.html. Owner-picked ids,
// shown in this order regardless of where they fall in PRODUCTS/shop.html.
const BEST_SELLER_IDS = ["planter-cedar", "bottle-opener-custom"];

function renderBestSellers() {
  const grid = document.getElementById("home-best-sellers-grid");
  if (!grid || typeof PRODUCTS === "undefined") return;
  const groups = groupProductsForDisplay()
    .filter(g => BEST_SELLER_IDS.includes(g.key))
    .sort((a, b) => BEST_SELLER_IDS.indexOf(a.key) - BEST_SELLER_IDS.indexOf(b.key));
  renderGridInto(grid, groups);
}

// laser-engraving.html's own "Shop engraved items" grid - every shippable
// (fulfillment: "ships") product, i.e. the full engraved-goods catalog,
// using the exact same buildProductCard() as Shop so customization panels,
// tiered/preset pricing and Round/Square toggles all work identically. No
// separate product list to maintain - it's the same "ships" filter Shop's
// own grid uses, so a new shippable item added to PRODUCTS shows up here
// automatically.
function renderEngravingShop() {
  const grid = document.getElementById("engraving-product-grid");
  if (!grid || typeof PRODUCTS === "undefined") return;
  const groups = groupProductsForDisplay().filter(g => g.variants[0].fulfillment === "ships");
  renderGridInto(grid, groups);
}

// Product/Offer JSON-LD for the shop grid, built straight from PRODUCTS so
// it can never drift from what the cards actually show. Mirrors the same
// "From $X" price picked by buildProductCard() above: the lowest sizeOptions
// or tieredPricing price, otherwise the flat price. Only runs on shop.html
// (i.e. only where the ships/pickup grids exist) - the home page's Best
// Sellers strip re-renders a couple of the same cards and would just
// duplicate this data.
function resolveOfferForGroup(group) {
  const primary = group.variants[0];
  let cents;
  if (primary.sizeOptions) {
    const prices = primary.sizeOptions.map(o => findProduct(o.id)).filter(Boolean).map(p => p.price);
    if (!prices.length) return null;
    cents = Math.min(...prices);
  } else if (primary.tieredPricing) {
    cents = Math.min(...primary.tieredPricing.map(t => t.price));
  } else if (typeof primary.price === "number") {
    cents = primary.price;
  } else {
    return null;
  }
  return { "@type": "Offer", price: (cents / 100).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock" };
}

function buildProductSchemaItems(groups, pageUrl) {
  return groups.map(group => {
    const primary = group.variants[0];
    const offer = resolveOfferForGroup(group);
    if (!offer) return null;
    const images = (primary.images && primary.images.length ? primary.images : [primary.image]).filter(Boolean);
    return {
      "@type": "Product",
      "sku": primary.id,
      "name": primary.groupName || primary.name,
      "description": primary.groupDescription || primary.description || primary.name,
      "image": images.map(src => `https://lonestarbuckeyes.com/${src}`),
      "url": `${pageUrl}#product-${group.key}`,
      "brand": { "@type": "Brand", "name": "Lonestar Buckeye Woodworks" },
      "offers": offer
    };
  }).filter(Boolean);
}

function injectProductSchema(items) {
  if (!items.length) return;
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": items });
  document.head.appendChild(script);
}

// Emits Product/Offer JSON-LD scoped to whichever grid is actually on the
// page, each with its own canonical url - shop.html's full catalog, or
// (once real Add to Cart landed there) laser-engraving.html's shippable
// subset, matching what that page's own grid renders. Never both on the
// same page.
function renderProductSchema() {
  if (typeof PRODUCTS === "undefined") return;

  const shopGrid = document.getElementById("shop-product-grid-ships") || document.getElementById("shop-product-grid-pickup");
  if (shopGrid) {
    injectProductSchema(buildProductSchemaItems(groupProductsForDisplay(), "https://lonestarbuckeyes.com/shop.html"));
    return;
  }

  const engravingGrid = document.getElementById("engraving-product-grid");
  if (engravingGrid) {
    const groups = groupProductsForDisplay().filter(g => g.variants[0].fulfillment === "ships");
    injectProductSchema(buildProductSchemaItems(groups, "https://lonestarbuckeyes.com/laser-engraving.html"));
  }
}

// Wires a real, working purchase control - identical to Shop's, including
// the pickup ZIP gate inside addToCart() - into a static marketing card on
// furniture.html/outdoor.html. Each card keeps its own hand-written photo,
// heading and description; only its `.product-controls[data-static-product]`
// placeholder gets filled in, via the exact same renderPurchaseControls()
// Shop uses. A no-op on any page without such a placeholder.
function wireStaticProductCards() {
  document.querySelectorAll(".product-controls[data-static-product]").forEach(controlsEl => {
    const product = findProduct(controlsEl.dataset.staticProduct);
    if (!product) return;

    if (product.stainOption) {
      const wrap = document.createElement("div");
      wrap.innerHTML = stainPanelHTML(product);
      controlsEl.parentNode.insertBefore(wrap.firstElementChild, controlsEl);
      wireStainPanel(controlsEl.parentNode.querySelector(".stain-panel"), product);
    }

    renderPurchaseControls(controlsEl, product);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  buildDrawer();
  buildZipModal();
  renderBadge();
  renderDrawerItems();
  renderCartPage();
  renderProductGrid();
  renderBestSellers();
  renderEngravingShop();
  renderProductSchema();
  wireStaticProductCards();
  scrollToHashProduct();

  document.querySelectorAll("#cart-nav-toggle").forEach(link => {
    link.addEventListener("click", e => {
      // On cart.html the link should navigate normally; everywhere else it
      // opens the drawer instead of leaving the page.
      if (!document.getElementById("cart-page-items")) {
        e.preventDefault();
        openDrawer();
      }
    });
  });

  const checkoutBtn = document.getElementById("cart-page-checkout");
  if (checkoutBtn) checkoutBtn.addEventListener("click", startCheckout);
});
