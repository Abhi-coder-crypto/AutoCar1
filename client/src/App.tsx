import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/NotificationBell";
import { AuthProvider, useAuth } from "@/lib/auth";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import ServiceVisits from "@/pages/ServiceVisits";
import Orders from "@/pages/Orders";
import Employees from "@/pages/Employees";
import Attendance from "@/pages/Attendance";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import Profile from "@/pages/Profile";
import RoleSelection from "@/pages/RoleSelection";
import UserManagement from "@/pages/UserManagement";
import Suppliers from "@/pages/Suppliers";
import PurchaseOrders from "@/pages/PurchaseOrders";
import Tasks from "@/pages/Tasks";
import Leaves from "@/pages/Leaves";
import Communications from "@/pages/Communications";
import CustomerRegistration from "@/pages/CustomerRegistration";
import CustomerRegistrationDashboard from "@/pages/CustomerRegistrationDashboard";
import { useEffect } from "react";
import { User } from "lucide-react";
import { Button } from "@/components/ui/button";

// Route to resource permission mapping
const ROUTE_PERMISSIONS: Record<string, { resource: string; action: string } | null> = {
  '/': null, // Dashboard is accessible to all authenticated users
  '/profile': null, // Profile is accessible to all authenticated users
  '/settings': null, // Settings is accessible to all authenticated users
  '/register-customer': null, // Customer registration is accessible to all authenticated users
  '/registration-dashboard': null, // Registration dashboard is accessible to all authenticated users
  '/products': { resource: 'products', action: 'read' },
  '/inventory': { resource: 'inventory', action: 'read' },
  '/orders': { resource: 'orders', action: 'read' },
  '/employees': { resource: 'employees', action: 'read' },
  '/attendance': { resource: 'attendance', action: 'read' },
  '/visits': { resource: 'orders', action: 'read' }, // Service visits use orders permission
  '/reports': { resource: 'reports', action: 'read' },
  '/users': { resource: 'users', action: 'read' }, // User management is admin-only
  '/suppliers': { resource: 'suppliers', action: 'read' },
  '/purchase-orders': { resource: 'purchaseOrders', action: 'read' },
  '/tasks': { resource: 'tasks', action: 'read' },
  '/leaves': { resource: 'leaves', action: 'read' },
  '/communications': { resource: 'communications', action: 'read' },
};

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user && location !== '/login' && location !== '/select-role') {
      setLocation('/select-role');
    }
  }, [user, isLoading, setLocation, location]);

  // Check route permissions after user is loaded
  useEffect(() => {
    if (user && !isLoading) {
      const routePermission = ROUTE_PERMISSIONS[location];
      
      // If route requires specific permission, check it
      if (routePermission) {
        const { resource, action } = routePermission;
        const hasAccess = user.permissions?.[resource]?.includes(action);
        
        if (!hasAccess) {
          // Redirect to dashboard if user doesn't have permission
          setLocation('/');
        }
      }
    }
  }, [user, isLoading, location, setLocation]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (!user) {
    return <div className="flex items-center justify-center h-screen">Redirecting...</div>;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/select-role" component={RoleSelection} />
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/users">
        {() => <ProtectedRoute component={UserManagement} />}
      </Route>
      <Route path="/products">
        {() => <ProtectedRoute component={Products} />}
      </Route>
      <Route path="/inventory">
        {() => <ProtectedRoute component={Inventory} />}
      </Route>
      <Route path="/visits">
        {() => <ProtectedRoute component={ServiceVisits} />}
      </Route>
      <Route path="/orders">
        {() => <ProtectedRoute component={Orders} />}
      </Route>
      <Route path="/employees">
        {() => <ProtectedRoute component={Employees} />}
      </Route>
      <Route path="/attendance">
        {() => <ProtectedRoute component={Attendance} />}
      </Route>
      <Route path="/reports">
        {() => <ProtectedRoute component={Reports} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} />}
      </Route>
      <Route path="/profile">
        {() => <ProtectedRoute component={Profile} />}
      </Route>
      <Route path="/suppliers">
        {() => <ProtectedRoute component={Suppliers} />}
      </Route>
      <Route path="/purchase-orders">
        {() => <ProtectedRoute component={PurchaseOrders} />}
      </Route>
      <Route path="/tasks">
        {() => <ProtectedRoute component={Tasks} />}
      </Route>
      <Route path="/leaves">
        {() => <ProtectedRoute component={Leaves} />}
      </Route>
      <Route path="/communications">
        {() => <ProtectedRoute component={Communications} />}
      </Route>
      <Route path="/register-customer">
        {() => <ProtectedRoute component={CustomerRegistration} />}
      </Route>
      <Route path="/registration-dashboard">
        {() => <ProtectedRoute component={CustomerRegistrationDashboard} />}
      </Route>
    </Switch>
  );
}

function AppLayout() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (location === '/select-role' || location === '/login') {
    return <Router />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              {user && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation('/profile')}
                  data-testid="button-profile"
                >
                  <User className="h-4 w-4 mr-2" />
                  {user.name}
                </Button>
              )}
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppLayout />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
