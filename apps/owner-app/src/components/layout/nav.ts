// One entry per route group under src/app/(modules) — mirrors the
// backend's bounded contexts (System Architecture FE.4). `permission`
// only hides the link; the backend still refuses the data (FE.5).

export interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', permission: 'dashboard:read' }],
  },
  {
    label: 'Trading',
    items: [
      { href: '/orders', label: 'Orders', permission: 'orders:read' },
      { href: '/procurement', label: 'Procurement', permission: 'procurement:read' },
      { href: '/inventory', label: 'Inventory', permission: 'inventory:read' },
      { href: '/logistics', label: 'Trips', permission: 'logistics:dispatch' },
    ],
  },
  {
    label: 'Partners & catalog',
    items: [
      { href: '/customers', label: 'Customers', permission: 'customers:read' },
      { href: '/farmers', label: 'Farmers', permission: 'farmers:read' },
      { href: '/products', label: 'Products', permission: 'products:read' },
      { href: '/vehicles', label: 'Vehicles', permission: 'vehicles:read' },
      { href: '/workforce', label: 'Workforce', permission: 'workforce:read' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/finance', label: 'Finance', permission: 'finance:read' },
      { href: '/accounting', label: 'Accounting', permission: 'accounting:read' },
    ],
  },
];
