// Full shop catalog.
// PLACEHOLDER PRICES on the "pickup" items — edit before real launch. All
// prices are in cents. This same list of ids/prices/fulfillment must be
// mirrored server-side in LonestarShopApp/catalog.py, which is the source
// of truth Stripe actually charges from (never trust prices sent from the
// browser).
//
// fulfillment: "ships"  -> small enough to ship anywhere. Shipping is a
//                          weight-based flat rate (see SHIPPING_WEIGHT_TIERS
//                          in cart.js) computed from each item's
//                          shipWeightOz x qty, collected at checkout.
// fulfillment: "pickup" -> local pickup only near McKinney, TX (75072).
//                          Buyer must pass a 50-mile ZIP check before this
//                          can be added to the cart (see cart.js), and
//                          pickup items can't share a cart with "ships"
//                          items (Stripe checkout can't mix the two).
const PRODUCTS = [
  // Display order on the shop page follows this array's order (within each
  // fulfillment section) - owner's requested order: bottle openers,
  // bookmarks, coasters, keychains.
  {
    // Tiered quantity pricing: price per unit drops at each breakpoint
    // below. tieredPricing must stay sorted by ascending minQty - tierPrice()
    // in cart.js walks it looking for the highest minQty the requested qty
    // meets. `price` stays as the base (1-4 pcs) rate, used anywhere a
    // single flat price is expected (e.g. cart line "each" price falls back
    // to it via tierPrice()).
    id: "bottle-opener-custom",
    name: "Custom Engraved Bottle Opener",
    description: "Wooden bottle opener with custom engraving — a popular groomsmen or event favor gift. Bulk pricing for events, weddings and business orders.",
    price: 1000, // $10.00 each, 1-4 pcs
    fulfillment: "ships",
    shipWeightOz: 3, // per-unit shipping weight - see SHIPPING_WEIGHT_TIERS in cart.js
    customizable: true, // shows the text/font or logo-upload panel - see cart.js
    tieredPricing: [
      { minQty: 1, price: 1000 },  // $10.00 each
      { minQty: 5, price: 900 },   // $9.00 each
      { minQty: 10, price: 850 },  // $8.50 each
      { minQty: 20, price: 800 },  // $8.00 each
      { minQty: 30, price: 750 },  // $7.50 each
      { minQty: 50, price: 600 }   // $6.00 each
    ],
    images: [
      "images/laser-bottle-opener-2.jpg",
      "images/laser-bottle-opener-3.avif",
      "images/laser-bottle-opener-4.avif",
      "images/laser-bottle-opener-5.avif",
      "images/laser-bottle-opener-6.avif"
    ]
  },
  {
    // Tiered quantity pricing - same schedule as the keychain/bottle opener.
    id: "bookmark-custom",
    name: "Custom Engraved Bookmark",
    description: "Personalized wooden bookmark with a name, quote or custom design, with tassel. Bulk pricing for events, weddings and business orders.",
    price: 1000, // $10.00 each, 1-4 pcs
    fulfillment: "ships",
    shipWeightOz: 1,
    customizable: true,
    tieredPricing: [
      { minQty: 1, price: 1000 },  // $10.00 each
      { minQty: 5, price: 900 },   // $9.00 each
      { minQty: 10, price: 850 },  // $8.50 each
      { minQty: 20, price: 800 },  // $8.00 each
      { minQty: 30, price: 750 },  // $7.50 each
      { minQty: 50, price: 600 }   // $6.00 each
    ],
    image: "images/laser-bookmarks.jpg"
  },
  {
    // Sold per-coaster so "set of N" and custom quantities are just
    // different qtys of the same unit price — no separate bundle SKUs
    // needed. presetSets drives the quick-pick buttons on the product card.
    // Same Round/Square variantGroup pattern as the slate coasters below —
    // same price either shape, just a different photo and cart id per shape.
    id: "coaster-cork-round",
    variantGroup: "coaster-cork",
    variantLabel: "Round",
    groupName: "Cork Engraved Coasters",
    groupDescription: "Custom engraved cork coasters — monogram, logo or design of your choice. Choose round or square, then pick a set size or enter your own quantity.",
    name: "Cork Engraved Coasters (Round)",
    price: 625, // $6.25 each -> set of 4 = $25.00 (matches the owner's existing $25/4 pricing)
    fulfillment: "ships",
    shipWeightOz: 1.5,
    customizable: true,
    image: "images/laser-coaster-cork-round.jpg",
    presetSets: [4, 6, 8]
  },
  {
    id: "coaster-cork-square",
    variantGroup: "coaster-cork",
    variantLabel: "Square",
    groupName: "Cork Engraved Coasters",
    groupDescription: "Custom engraved cork coasters — monogram, logo or design of your choice. Choose round or square, then pick a set size or enter your own quantity.",
    name: "Cork Engraved Coasters (Square)",
    price: 625, // $6.25 each -> set of 4 = $25.00
    fulfillment: "ships",
    shipWeightOz: 1.5,
    customizable: true,
    image: "images/laser-coaster-cork-square.jpg",
    presetSets: [4, 6, 8]
  },
  // Slate coasters come in two shapes with different photo sets, but the
  // same per-coaster price — modeled as two variants of one card (shared
  // variantGroup) rather than two separate cards, with a Round/Square
  // toggle switching both the photo carousel and which id actually gets
  // added to the cart. Each variant keeps its own real id/name so Stripe
  // (and the owner) can tell which shape a customer ordered.
  {
    id: "coaster-slate-round",
    variantGroup: "coaster-slate",
    variantLabel: "Round",
    groupName: "Slate Engraved Coasters",
    groupDescription: "Custom engraved 4x4in slate coasters with a cork backing — a heavier, more premium option than cork. Choose round or square, then pick a set size or enter your own quantity.",
    name: "Slate Engraved Coasters (Round)",
    price: 750, // $7.50 each -> set of 4 = $30.00
    fulfillment: "ships",
    shipWeightOz: 6, // slate is much heavier than cork/wood
    customizable: true,
    presetSets: [4, 6, 8],
    images: [
      "images/laser-coaster-slate-round-1.png",
      "images/laser-coaster-slate-round-2.png",
      "images/laser-coaster-slate-round-3.png",
      "images/laser-coaster-slate-round-4.png",
      "images/laser-coaster-slate-round-5.png"
    ]
  },
  {
    id: "coaster-slate-square",
    variantGroup: "coaster-slate",
    variantLabel: "Square",
    groupName: "Slate Engraved Coasters",
    groupDescription: "Custom engraved 4x4in slate coasters with a cork backing — a heavier, more premium option than cork. Choose round or square, then pick a set size or enter your own quantity.",
    name: "Slate Engraved Coasters (Square)",
    price: 750, // $7.50 each -> set of 4 = $30.00
    fulfillment: "ships",
    shipWeightOz: 6,
    customizable: true,
    presetSets: [4, 6, 8],
    images: [
      "images/laser-coaster-slate-square-1.png",
      "images/laser-coaster-slate-square-2.png"
    ]
  },
  {
    // Tiered quantity pricing - same schedule as the bottle opener, see
    // its comment for how tieredPricing/tierUnitPrice() work.
    id: "keychain-custom",
    name: "Custom Engraved Keychain",
    description: "Personalized wooden keychain — scenic, motivational, faith-inspired or custom text designs. Bulk pricing for events, weddings and business orders.",
    price: 1000, // $10.00 each, 1-4 pcs
    fulfillment: "ships",
    shipWeightOz: 1,
    customizable: true,
    tieredPricing: [
      { minQty: 1, price: 1000 },  // $10.00 each
      { minQty: 5, price: 900 },   // $9.00 each
      { minQty: 10, price: 850 },  // $8.50 each
      { minQty: 20, price: 800 },  // $8.00 each
      { minQty: 30, price: 750 },  // $7.50 each
      { minQty: 50, price: 600 }   // $6.00 each
    ],
    images: [
      "images/laser-keychain-custom-1.png",
      "images/laser-keychain-custom-2.png",
      "images/laser-keychain-custom-3.png",
      "images/laser-keychain-custom-4.png",
      "images/laser-keychain-custom-5.png",
      "images/laser-keychain-custom-6.png"
    ]
  },
  // Cutting boards: same sizeOptions/hiddenFromGrid pattern as the cedar
  // planter - two real, separately-priced PRODUCTS entries so the
  // cart/Stripe/owner know exactly which size was ordered, listed via one
  // display entry's sizeOptions dropdown (price looked up live via
  // findProduct so it can never drift). Real prices from the owner
  // 2026-08-16 (they can be adjusted - no confirmed cost basis yet).
  {
    id: "cutting-board-12x8",
    name: 'Cutting Board (12" x 8")',
    price: 3200, // $32.00
    fulfillment: "ships",
    shipWeightOz: 24, // ~1.5 lb bamboo board
    hiddenFromGrid: true,
    customizable: true,
    image: "images/cutting-board-12x8.jpg"
  },
  {
    id: "cutting-board-15x11",
    name: 'Cutting Board (15" x 11")',
    price: 4400, // $44.00
    fulfillment: "ships",
    shipWeightOz: 32, // ~2 lb bamboo board
    hiddenFromGrid: true,
    customizable: true,
    image: "images/cutting-board-15x11.jpg"
  },
  {
    id: "cutting-board",
    name: "Bamboo Cutting Board",
    description: "Bamboo cutting board with a built-in juice groove. Pick a standard size below, or request a custom size.",
    fulfillment: "ships",
    customizable: true,
    images: [
      "images/cutting-board-12x8.jpg",
      "images/cutting-board-15x11.jpg"
    ],
    sizeOptions: [
      { id: "cutting-board-12x8", label: '12" x 8"' },
      { id: "cutting-board-15x11", label: '15" x 11"' }
    ]
  },

  // --- Local pickup only (McKinney, TX / 75072 area) ------------------
  // Display order is owner-requested (2026-08-15): cedar planters first
  // (best seller so far), then console table, then both porch swings, then
  // the solid wood bench, then garden bench.
  // PLACEHOLDER PRICES on most of these — they've only ever been
  // quote-based pieces. Replace with real prices before launch (edit here
  // AND in LonestarShopApp/catalog.py, same id/price on both sides). The
  // cedar planter is the exception — real prices already set.
  //
  // Cedar planters: one listing, one shared carousel, a size dropdown that
  // determines price. Each size is its own real PRODUCTS entry (so the
  // cart/Stripe/owner always know exactly which size was ordered) but
  // `hiddenFromGrid` keeps them from showing up as separate cards — only
  // the "planter-cedar" display entry below renders a card, and its
  // `sizeOptions` list (id + label only, price is looked up live via
  // findProduct so it can never drift from what's actually charged) drives
  // the dropdown. These are real prices from the owner, not placeholders.
  {
    id: "planter-cedar-12x12",
    name: "Cedar Planter (12\" x 12\" x 12\")",
    price: 3000, // $30.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-12x12-plain.jpg" // just for cart-line thumbnails; the card carousel lives on the "planter-cedar" entry
  },
  {
    id: "planter-cedar-16x16",
    name: "Cedar Planter (16\" x 16\" x 16\")",
    price: 4500, // $45.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-16x16-labeled.jpg"
  },
  {
    id: "planter-cedar-24x16",
    name: "Cedar Planter (24\" x 16\" x 16\")",
    price: 4500, // $45.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-24x16-pair-labeled.jpg"
  },
  {
    id: "planter-cedar-32x16",
    name: "Cedar Planter (32\" x 16\" x 16\")",
    price: 5500, // $55.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-32x16-plain.jpg"
  },
  {
    id: "planter-cedar-48x16",
    name: "Cedar Planter (48\" x 16\" x 16\")",
    price: 9500, // $95.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-48x16-plain.jpg"
  },
  {
    // No dedicated photo for this size — closest available (48"-long,
    // next size up in width) as a reasonable stand-in for the cart thumbnail.
    id: "planter-cedar-48x24",
    name: "Cedar Planter (48\" x 24\" x 16\")",
    price: 10500, // $105.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-48x16-plain.jpg"
  },
  {
    // No dedicated photo for this (largest) size — the lifestyle shot reads
    // well as a stand-in for the cart thumbnail.
    id: "planter-cedar-70x24",
    name: "Cedar Planter (70\" x 24\" x 16\")",
    price: 12500, // $125.00
    fulfillment: "pickup",
    hiddenFromGrid: true,
    image: "images/cedar-planter-48x16-lifestyle.jpg"
  },
  {
    id: "planter-cedar",
    name: "Cedar Planter",
    description: "Handcrafted cedar planter box, built locally. Pick a standard size below, or request a custom size built to your exact length x width x height.",
    fulfillment: "pickup",
    images: [
      "images/cedar-planter-12x12-labeled.jpg",
      "images/cedar-planter-12x12-plain.jpg",
      "images/cedar-planter-16x16-labeled.jpg",
      "images/cedar-planter-24x16-pair-labeled.jpg",
      "images/cedar-planter-32x16-plain.jpg",
      "images/cedar-planter-32x16-labeled.jpg",
      "images/cedar-planter-48x16-plain.jpg",
      "images/cedar-planter-48x16-lifestyle.jpg"
    ],
    sizeOptions: [
      { id: "planter-cedar-12x12", label: "12\" x 12\" x 12\"" },
      { id: "planter-cedar-16x16", label: "16\" x 16\" x 16\"" },
      { id: "planter-cedar-24x16", label: "24\" x 16\" x 16\"" },
      { id: "planter-cedar-32x16", label: "32\" x 16\" x 16\"" },
      { id: "planter-cedar-48x16", label: "48\" x 16\" x 16\"" },
      { id: "planter-cedar-48x24", label: "48\" x 24\" x 16\"" },
      { id: "planter-cedar-70x24", label: "70\" x 24\" x 16\"" }
    ]
  },
  {
    id: "console-table-farmhouse",
    name: "Farmhouse Console Table",
    description: "Entryway-ready console table with farmhouse styling, a lower shelf and custom stain options.",
    price: 24900, // PLACEHOLDER — $249.00
    fulfillment: "pickup",
    image: "images/console-table.jpg"
  },
  {
    id: "porch-swing-classic",
    name: "Classic Porch Swing",
    description: "Handcrafted porch swing with a wide seat, armrests and a clean, sturdy profile. Natural or stained finish.",
    price: 39900, // PLACEHOLDER — $399.00
    fulfillment: "pickup",
    image: "images/swing-finished.jpg",
    stainOption: true,
    stainUpcharge: 7900 // +$79.00 for a stained finish, owner-specified 2026-08-15
  },
  {
    id: "porch-swing-console",
    name: "Porch Swing with Center Console",
    description: "Our porch swing design plus a built-in center console for drinks or décor — a popular premium upgrade.",
    price: 49900, // PLACEHOLDER — $499.00
    fulfillment: "pickup",
    image: "images/swing-console.jpg",
    stainOption: true,
    stainUpcharge: 7900 // +$79.00 for a stained finish, owner-specified 2026-08-15
  },
  {
    id: "bench-solid-wood",
    name: "Modern Solid Wood Bench",
    description: "Clean-lined solid wood bench with a chunky profile — porches, mudrooms, entryways or coffee-table style seating.",
    price: 14900, // PLACEHOLDER — $149.00
    fulfillment: "pickup",
    image: "images/bench-front.jpg"
  },
  {
    id: "garden-bench",
    name: "Garden Bench",
    description: "Straightforward outdoor bench with a backrest — gardens, patios and fire pit seating areas.",
    price: 17900, // PLACEHOLDER — $179.00
    fulfillment: "pickup",
    image: "images/garden-bench.jpg"
  }
];
