'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Opens a page's create form when it's reached with ?new=1 — the links in
 * the (+) sheet (redesign V1.1), and "New Order" on a customer's profile,
 * which adds who it's for (?customer=…). The form gets the parameters; they
 * are then removed, so Back or a reload doesn't open the form again.
 */
export function useOpenOnNew(open: (params: URLSearchParams) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (params.get('new') !== '1') return;
    open(new URLSearchParams(params.toString()));
    router.replace(pathname, { scroll: false });
    // Only when the parameter appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
}
