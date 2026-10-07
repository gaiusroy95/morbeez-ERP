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

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', icon: 'dashboard', label: 'Dashboard', permission: 'dashboard:read' },
      { href: '/alerts', icon: 'bell', label: 'Alerts & summary', permission: 'dashboard:read' },
      { href: '/ai', icon: 'sparkles', label: 'Suggestions', permission: 'ai:read' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { href: '/orders', icon: 'receipt', label: 'Orders', permission: 'orders:read' },
      { href: '/procurement', icon: 'basket', label: 'Procurement', permission: 'procurement:read' },
      { href: '/inventory', icon: 'boxes', label: 'Inventory', permission: 'inventory:read' },
      { href: '/logistics', icon: 'truck', label: 'Trips', permission: 'logistics:dispatch' },
      { href: '/delegation', icon: 'key', label: 'Delegation', permission: 'logistics:dispatch' },
      { href: '/spot-sales', icon: 'bolt', label: 'Spot sales', permission: 'spot_sales:read' },
      { href: '/crates', icon: 'crate', label: 'Crates', permission: 'crates:read' },
    ],
  },
  {
    label: 'Partners & catalog',
    items: [
      { href: '/customers', icon: 'users', label: 'Customers', permission: 'customers:read' },
      { href: '/farmers', icon: 'sprout', label: 'Farmers', permission: 'farmers:read' },
      { href: '/products', icon: 'leaf', label: 'Products', permission: 'products:read' },
      { href: '/vehicles', icon: 'steering', label: 'Vehicles', permission: 'vehicles:read' },
      { href: '/workforce', icon: 'badge', label: 'Workforce', permission: 'workforce:read' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/finance', icon: 'wallet', label: 'Finance', permission: 'finance:read' },
      { href: '/accounting', icon: 'book', label: 'Accounting', permission: 'accounting:read' },
      { href: '/tax', icon: 'percent', label: 'Tax', permission: 'tax:read' },
    ],
  },
  {
    // No permission: everyone can manage their own sign-in. Also the only way
    // to it on a phone, where the top bar hides the email.
    label: 'You',
    items: [{ href: '/account', icon: 'user', label: 'Your account' }],
  },
];
