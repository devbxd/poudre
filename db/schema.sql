-- Poudre Beauty — database schema (PostgreSQL 15+)
-- IDs imported from WooCommerce are kept so URLs and references stay identical.

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Staff accounts (dashboard + POS)
create table if not exists staff (
  id serial primary key,
  name text not null,
  username text unique not null,
  email text,
  password_hash text not null,
  pin_hash text,                       -- quick POS login
  role text not null default 'cashier' check (role in ('owner','manager','cashier')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists media (
  id serial primary key,
  url text not null,
  filename text,
  mime text,
  width int,
  height int,
  alt text default '',
  title text default '',
  caption text default '',
  sizes jsonb default '[]',
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id serial primary key,
  parent_id int references categories(id) on delete set null,
  name text not null,
  slug text unique not null,
  description text default '',
  image text,
  menu_order int not null default 0,
  visible boolean not null default true,     -- shown on the website
  pos_visible boolean not null default true, -- shown in the POS
  created_at timestamptz not null default now()
);

create table if not exists brands (
  id serial primary key,
  name text not null,
  slug text unique not null,
  description text default '',
  image text,
  visible boolean not null default true,
  menu_order int not null default 0
);

create table if not exists tags (
  id serial primary key,
  name text not null,
  slug text unique not null
);

create table if not exists attributes (
  id serial primary key,
  name text not null,
  slug text unique not null,
  terms jsonb not null default '[]'
);

create table if not exists suppliers (
  id serial primary key,
  name text not null,
  code text,
  email text,
  phone text,
  website text,
  address jsonb default '{}',
  currency text default 'USD',
  lead_time_days int,
  notes text default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id serial primary key,
  type text not null default 'simple' check (type in ('simple','variable','bundle','service')),
  status text not null default 'publish' check (status in ('publish','draft','private','archived')),
  name text not null,
  slug text unique not null,
  sku text,
  barcode text,
  description text default '',
  short_description text default '',
  regular_price numeric(12,2),
  sale_price numeric(12,2),
  sale_from timestamptz,
  sale_to timestamptz,
  purchase_price numeric(12,2),
  manage_stock boolean not null default false,
  stock_quantity int,
  stock_status text not null default 'instock' check (stock_status in ('instock','outofstock','onbackorder')),
  backorders text not null default 'no' check (backorders in ('no','notify','yes')),
  low_stock_amount int,
  weight numeric(10,3),
  dimensions jsonb default '{}',
  featured boolean not null default false,
  catalog_visibility text not null default 'visible' check (catalog_visibility in ('visible','catalog','search','hidden')),
  online_visible boolean not null default true,
  pos_visible boolean not null default true,
  supplier_id int references suppliers(id) on delete set null,
  supplier_sku text,
  tax_status text default 'taxable',
  menu_order int not null default 0,
  reviews_allowed boolean not null default true,
  images jsonb not null default '[]',          -- [{id,url,alt}] first = main image
  attributes jsonb not null default '[]',      -- [{name,options[],visible,variation}]
  default_attributes jsonb not null default '[]',
  upsell_ids int[] not null default '{}',
  cross_sell_ids int[] not null default '{}',
  bundle_items jsonb not null default '[]',    -- [{product_id,variation_id,qty}]
  seo jsonb not null default '{}',
  meta jsonb not null default '{}',
  total_sales int not null default 0,
  average_rating numeric(3,2) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_sku_idx on products (sku);
create index if not exists products_barcode_idx on products (barcode);
create index if not exists products_status_idx on products (status);
create index if not exists products_name_idx on products (lower(name));

create table if not exists product_categories (
  product_id int references products(id) on delete cascade,
  category_id int references categories(id) on delete cascade,
  primary key (product_id, category_id)
);
create table if not exists product_brands (
  product_id int references products(id) on delete cascade,
  brand_id int references brands(id) on delete cascade,
  primary key (product_id, brand_id)
);
create table if not exists product_tags (
  product_id int references products(id) on delete cascade,
  tag_id int references tags(id) on delete cascade,
  primary key (product_id, tag_id)
);
create index if not exists product_categories_cat_idx on product_categories (category_id);
create index if not exists product_brands_brand_idx on product_brands (brand_id);
create index if not exists product_tags_tag_idx on product_tags (tag_id);
create index if not exists products_created_idx on products (created_at desc);

create table if not exists variations (
  id serial primary key,
  product_id int not null references products(id) on delete cascade,
  status text not null default 'publish',
  sku text,
  barcode text,
  attributes jsonb not null default '[]',      -- [{name,option}]
  regular_price numeric(12,2),
  sale_price numeric(12,2),
  sale_from timestamptz,
  sale_to timestamptz,
  purchase_price numeric(12,2),
  manage_stock boolean not null default false,
  stock_quantity int,
  stock_status text not null default 'instock',
  backorders text not null default 'no',
  low_stock_amount int,
  image jsonb,
  weight numeric(10,3),
  description text default '',
  supplier_id int references suppliers(id) on delete set null,
  supplier_sku text,
  menu_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists variations_product_idx on variations (product_id);
create index if not exists variations_sku_idx on variations (sku);
create index if not exists variations_barcode_idx on variations (barcode);

create table if not exists customers (
  id serial primary key,
  first_name text default '',
  last_name text default '',
  email text,
  phone text,
  billing jsonb not null default '{}',
  shipping jsonb not null default '{}',
  password_hash text,
  notes text default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_email_idx on customers (lower(email)) where email is not null and email <> '';
create index if not exists customers_phone_idx on customers (phone);

create table if not exists coupons (
  id serial primary key,
  code text unique not null,
  type text not null default 'percent' check (type in ('percent','fixed_cart','fixed_product')),
  amount numeric(12,2) not null default 0,
  description text default '',
  expires_at timestamptz,
  min_amount numeric(12,2),
  max_amount numeric(12,2),
  usage_limit int,
  usage_limit_per_user int,
  usage_count int not null default 0,
  individual_use boolean not null default false,
  free_shipping boolean not null default false,
  exclude_sale_items boolean not null default false,
  product_ids int[] not null default '{}',
  excluded_product_ids int[] not null default '{}',
  category_ids int[] not null default '{}',
  excluded_category_ids int[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id serial primary key,
  number text,
  status text not null default 'pending'
    check (status in ('pending','processing','on-hold','completed','cancelled','refunded','failed')),
  channel text not null default 'online' check (channel in ('online','pos','manual')),
  customer_id int references customers(id) on delete set null,
  billing jsonb not null default '{}',
  shipping jsonb not null default '{}',
  currency text not null default 'USD',
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  shipping_total numeric(12,2) not null default 0,
  fee_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  refunded_total numeric(12,2) not null default 0,
  payment_method text,
  payment_title text,
  shipping_method text,
  coupon_codes text[] not null default '{}',
  cash_tendered numeric(12,2),
  cash_change numeric(12,2),
  staff_id int references staff(id) on delete set null,
  cash_session_id int,
  customer_note text default '',
  invoice_number text,
  meta jsonb not null default '{}',
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_customer_idx on orders (customer_id);

create table if not exists order_items (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  product_id int,
  variation_id int,
  name text not null,
  sku text,
  quantity int not null default 1,
  unit_price numeric(12,2) not null default 0,
  purchase_price numeric(12,2),
  subtotal numeric(12,2) not null default 0,  -- before discounts
  total numeric(12,2) not null default 0,     -- after discounts
  refunded_qty int not null default 0,
  meta jsonb not null default '{}'
);
create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_product_idx on order_items (product_id);

create table if not exists order_notes (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  note text not null,
  author text,
  customer_visible boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id serial primary key,
  order_id int not null references orders(id) on delete cascade,
  amount numeric(12,2) not null,
  reason text default '',
  items jsonb not null default '[]',
  restock boolean not null default true,
  staff_id int references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id serial primary key,
  product_id int references products(id) on delete cascade,
  author text not null,
  email text,
  rating int check (rating between 1 and 5),
  content text not null default '',
  status text not null default 'pending' check (status in ('approved','pending','spam')),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id serial primary key,
  number text,
  supplier_id int references suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','ordered','partial','received','cancelled')),
  expected_at timestamptz,
  received_at timestamptz,
  total numeric(12,2) not null default 0,
  notes text default '',
  items jsonb not null default '[]',  -- [{product_id,variation_id,name,sku,qty,received_qty,cost}]
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every stock change is logged (sales, refunds, purchases, manual adjustments, damage…)
create table if not exists stock_movements (
  id bigserial primary key,
  product_id int,
  variation_id int,
  change int not null,
  quantity_after int,
  reason text not null check (reason in ('sale','refund','cancel','purchase','adjustment','damage','return','count','import')),
  ref_type text,
  ref_id int,
  note text default '',
  staff_id int,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on stock_movements (product_id, created_at desc);

-- POS cash register sessions
create table if not exists cash_sessions (
  id serial primary key,
  staff_id int references staff(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_cash numeric(12,2) not null default 0,
  closed_at timestamptz,
  closing_cash numeric(12,2),
  expected_cash numeric(12,2),
  cash_in_out jsonb not null default '[]',   -- [{amount,reason,at}]
  notes text default ''
);

create table if not exists pages (
  id serial primary key,
  slug text unique not null,
  title text not null,
  content text not null default '',     -- rendered HTML of the page body
  template text not null default 'default',
  status text not null default 'publish' check (status in ('publish','draft')),
  seo jsonb not null default '{}',
  menu_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists posts (
  id serial primary key,
  slug text unique not null,
  title text not null,
  excerpt text default '',
  content text not null default '',
  image text,
  categories text[] not null default '{}',
  status text not null default 'publish' check (status in ('publish','draft')),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menus (
  id serial primary key,
  location text unique not null,   -- primary, topbar, footer-1…
  name text not null,
  items jsonb not null default '[]' -- [{id,title,url,type,object_id,children:[]}]
);

create table if not exists messages (
  id serial primary key,
  kind text not null default 'contact',  -- contact, newsletter
  name text, email text, phone text,
  subject text, body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  staff_id int,
  action text not null,
  entity text,
  entity_id text,
  details jsonb default '{}',
  created_at timestamptz not null default now()
);

-- Website carts (one per visitor cookie)
create table if not exists carts (
  id text primary key,
  items jsonb not null default '[]',        -- [{key, product_id, variation_id, quantity, variation:{attribute_x: value}}]
  coupons text[] not null default '{}',
  shipping_method text,
  customer jsonb not null default '{}',     -- {billing_address, shipping_address}
  customer_id int,
  updated_at timestamptz not null default now()
);

-- Website wishlists (one per visitor cookie)
create table if not exists wishlists (
  id text primary key,
  items jsonb not null default '{}',        -- {product_id: {time, price}}
  customer_id int,
  updated_at timestamptz not null default now()
);
create index if not exists reviews_product_idx on reviews (product_id);
create index if not exists order_items_variation_idx on order_items (variation_id);
