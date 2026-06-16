import { useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useLocation } from 'react-router';
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { Bot, ClipboardList, HeartPulse, MapPinned, Menu, Search } from 'lucide-react';
import { CopilotPage } from './pages/CopilotPage';
import { ExplorePage } from './pages/ExplorePage';
import { IndiaMapPage } from './pages/IndiaMapPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';

const navigation = [
  { to: '/', label: 'India', icon: MapPinned, end: true },
  { to: '/map', label: 'State map', icon: MapPinned },
  { to: '/explore', label: 'Evidence', icon: Search },
  { to: '/plans', label: 'Actions', icon: ClipboardList },
  { to: '/copilot', label: 'Copilot', icon: Bot },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {navigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <HeartPulse className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">Chikitsa Copilot</h1>
        <p className="text-xs text-muted-foreground">India health-action planner</p>
      </div>
    </div>
  );
}

function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isImmersiveLanding = location.pathname === '/';

  if (isImmersiveLanding) {
    return (
      <div className="min-h-screen bg-background">
        <main className="min-h-screen p-3 md:p-4">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-card px-4 py-5 lg:block">
        <Brand />
        <div className="mt-8">
          <NavItems />
        </div>
        <div className="absolute bottom-5 left-4 right-4 rounded-xl border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Hackathon MVP</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            India planning demo using NFHS-5, PIN geography, and marketplace facilities.
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-10 flex h-16 items-center border-b bg-background/95 px-4 backdrop-blur lg:ml-64 lg:px-7">
        <div className="lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
            <SheetContent side="left" className="w-72">
              <SheetHeader>
                <SheetTitle className="sr-only">Navigation</SheetTitle>
              </SheetHeader>
              <Brand />
              <div className="mt-8">
                <NavItems onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        <div className="ml-2 lg:hidden">
          <Brand />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">Evidence is directional, not clinical advice</span>
          <span className="h-2 w-2 rounded-full bg-success" aria-label="System available" />
        </div>
      </header>

      <main className="px-4 py-6 lg:ml-64 lg:px-7 lg:py-8">
        <div className="mx-auto max-w-[1500px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/map', element: <IndiaMapPage /> },
      { path: '/explore', element: <ExplorePage /> },
      { path: '/plans', element: <PlansPage /> },
      { path: '/copilot', element: <CopilotPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
