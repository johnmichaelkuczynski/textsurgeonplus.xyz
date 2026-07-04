import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import PaymentSuccess from "@/pages/PaymentSuccess";
import PositionsManager from "@/pages/PositionsManager";
import Administrative from "@/pages/Administrative";

const CLERK_ENABLED = ((import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string) || "").startsWith("pk_");

function SsoCallback() {
  if (!CLERK_ENABLED) return <Home />;
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <AuthenticateWithRedirectCallback afterSignInUrl="/" afterSignUpUrl="/" />
      Signing you in...
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/sso-callback" component={SsoCallback} />
      <Route path="/administrative" component={Administrative} />
      <Route path="/positions" component={PositionsManager} />
      <Route path="/payment/success" component={PaymentSuccess} />
      <Route path="/payment/cancel" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;