// One entry per route group under src/app/(modules) — mirrors the
// backend's bounded contexts (System Architecture FE.4). `permission`
// only hides the link; the backend still refuses the data (FE.5).

import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type BottomTab = (NavItem & { kind: 'link' }) | { kind: 'create' } | { kind: 'more' };

/**
 * The phone tab bar (client design V1.1, docs/redesign): Home · Operations ·
 * (+) · Finance · More. The (+) opens QUICK_CREATE; More opens the side menu.
 */
export const BOTTOM_TABS: BottomTab[] = [
  { kind: 'link', href: '/dashboard', icon: 'home', label: 'Home', permission: 'dashboard:read' },
  { kind: 'link', href: '/operations', icon: 'grid', label: 'Operations' },
  { kind: 'create' },
  { kind: 'link', href: '/finance', icon: 'wallet', label: 'Finance', permission: 'finance:read' },
  { kind: 'more' },
];

/** What the (+) button creates. Each opens its page with the new form already open (?new=1). */
export const QUICK_CREATE: NavItem[] = [
  { href: '/procurement?new=1', icon: 'basket', label: 'Create Procurement', permission: 'procurement:write' },
  { href: '/orders?new=1', icon: 'receipt', label: 'Create Delivery Order', permission: 'orders:write' },
  { href: '/logistics?new=1', icon: 'truck', label: 'Create Trip', permission: 'logistics:dispatch' },
  { href: '/customers?new=1', icon: 'users', label: 'Add Customer', permission: 'customers:write' },
  { href: '/farmers?new=1', icon: 'sprout', label: 'Add Farmer', permission: 'farmers:write' },
  { href: '/collections?new=1', icon: 'rupee', label: 'Add Collection', permission: 'finance:collect' },
];

/** The Operations hub's tiles (design screen 2, "Operations"). */
export const OPERATIONS: (NavItem & { description: string })[] = [
  { href: '/procurement', icon: 'basket', label: 'Procurement', description: 'Purchase from farmers', permission: 'procurement:read' },
  { href: '/orders', icon: 'receipt', label: 'Delivery Orders', description: 'Orders to customers', permission: 'orders:read' },
  { href: '/logistics', icon: 'truck', label: 'Trips', description: 'Plan & assign trips', permission: 'logistics:dispatch' },
  { href: '/inventory', icon: 'boxes', label: 'Inventory', description: 'Stock in vehicles', permission: 'inventory:read' },
  { href: '/customers', icon: 'users', label: 'Customers', description: 'Customer management', permission: 'customers:read' },
  { href: '/farmers', icon: 'sprout', label: 'Farmers', description: 'Farmer management', permission: 'farmers:read' },
  { href: '/collections', icon: 'rupee', label: 'Collections', description: 'Record payments', permission: 'finance:read' },
  { href: '/alerts', icon: 'alert', label: 'Exceptions', description: 'Issues & adjustments', permission: 'dashboard:read' },
];

/** The side menu (design screen "Side Menu"). */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: 'home', label: 'Dashboard', permission: 'dashboard:read' },
      { href: '/operations', icon: 'grid', label: 'Operations' },
      { href: '/alerts', icon: 'bell', label: 'Alerts & summary', permission: 'dashboard:read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/procurement', icon: 'basket', label: 'Procurement', permission: 'procurement:read' },
      { href: '/orders', icon: 'receipt', label: 'Delivery Orders', permission: 'orders:read' },
      { href: '/logistics', icon: 'truck', label: 'Trips', permission: 'logistics:dispatch' },
      // Routes are read by everyone who plans orders or trips; changing them is checked server-side.
      { href: '/routes', icon: 'pin', label: 'Routes' },
      { href: '/inventory', icon: 'boxes', label: 'Inventory', permission: 'inventory:read' },
      { href: '/customers', icon: 'users', label: 'Customers', permission: 'customers:read' },
      { href: '/farmers', icon: 'sprout', label: 'Farmers', permission: 'farmers:read' },
      { href: '/collections', icon: 'rupee', label: 'Collections', permission: 'finance:read' },
      { href: '/delegation', icon: 'key', label: 'Delegation', permission: 'logistics:dispatch' },
      { href: '/spot-sales', icon: 'bolt', label: 'Spot sales', permission: 'spot_sales:read' },
      { href: '/crates', icon: 'crate', label: 'Crates', permission: 'crates:read' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance', icon: 'wallet', label: 'Finance', permission: 'finance:read' },
      { href: '/profit', icon: 'chart', label: 'Profit & Insights', permission: 'dashboard:profit' },
      { href: '/accounting', icon: 'book', label: 'Accounting', permission: 'accounting:read' },
      { href: '/tax', icon: 'percent', label: 'Tax', permission: 'tax:read' },
    ],
  },
  {
    label: 'AI',
    items: [{ href: '/ai', icon: 'sparkles', label: 'Suggestions', permission: 'ai:read' }],
  },
  {
    label: 'People & Assets',
    items: [
      { href: '/workforce', icon: 'badge', label: 'Workforce', permission: 'workforce:read' },
      { href: '/vehicles', icon: 'steering', label: 'Vehicles', permission: 'vehicles:read' },
      { href: '/products', icon: 'leaf', label: 'Products', permission: 'products:read' },
    ],
  },
];
