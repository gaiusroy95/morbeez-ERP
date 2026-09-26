import { AppShell } from '@/components/layout/AppShell';

export default function ModulesLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
