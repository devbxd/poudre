# Differences with the WordPress site

The new website reproduces the WordPress site (same HTML, same CSS, same images).
The points below are the only intentional differences: they are bugs of the old site.

| Where | Old site (WordPress) | New site | Why |
|---|---|---|---|
| Shop: product count | "1–32 Products of 1792 Products" while only 1766 are shown | Counts the products actually shown | A visibility plugin hid products after counting them, so some pages showed fewer than 32 products |
| Sidebar: category counts | Cached numbers, some wrong (Accessories showed "-37") | Real number of products visible to customers | WooCommerce count cache was stale |
| Price filter maximum | Included products hidden from customers (e.g. Bridal Makeup Package, $400) | Only products customers can see | Same plugin issue |
| Instant search (header) | Returned "No data found." for every search | Returns matching products | The AJAX search was broken |
