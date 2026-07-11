import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Users, Clock, CalendarDays, CalendarRange, ShieldAlert, CalendarCheck } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type SeriesPoint = { label: string; count: number };

type AdminVisitsResponse = {
  stats: {
    allTime: number;
    last24Hours: number;
    lastWeek: number;
    lastMonth: number;
    lastYear: number;
  };
  series: {
    last24Hours: SeriesPoint[];
    lastWeek: SeriesPoint[];
    lastMonth: SeriesPoint[];
    lastYear: SeriesPoint[];
    allTime: SeriesPoint[];
  };
  visits: { id: number; email: string | null; visitedAt: string }[];
};

type AuthUserResponse = {
  authenticated: boolean;
  user: { id: number; username: string; email: string | null; displayName: string | null } | null;
};

const ADMIN_EMAIL = "johnmichaelkuczynski@gmail.com";

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: string }) {
  return (
    <Card className="shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        <Icon className={`w-5 h-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>
          {value.toLocaleString()}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Google logins</p>
      </CardContent>
    </Card>
  );
}

function VisitChart({ title, data }: { title: string; data: SeriesPoint[] }) {
  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#6d28d9" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Administrative() {
  const { data: auth, isLoading: authLoading } = useQuery<AuthUserResponse>({
    queryKey: ["/api/auth/user"],
  });

  const isAdmin = auth?.authenticated && auth.user?.email?.toLowerCase() === ADMIN_EMAIL;

  const { data, isLoading } = useQuery<AdminVisitsResponse>({
    queryKey: ["/api/admin/visits"],
    enabled: !!isAdmin,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background p-10">
        <Skeleton className="h-10 w-64 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-10">
        <ShieldAlert className="w-16 h-16 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">This page is restricted to the site administrator.</p>
        <Link href="/">
          <Button variant="outline" data-testid="button-back-home">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-4 border-primary sticky top-0 z-50 bg-white shadow-lg">
        <div className="w-full px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="w-7 h-7 text-primary" />
            <h1 className="font-bold text-2xl tracking-tight">ADMINISTRATIVE</h1>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm" data-testid="button-back">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to App
            </Button>
          </Link>
        </div>
      </header>

      <main className="p-10 space-y-8 max-w-7xl mx-auto">
        {isLoading || !data ? (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard title="All Time" value={data.stats.allTime} icon={Users} color="text-primary" />
              <StatCard title="Last 24 Hours" value={data.stats.last24Hours} icon={Clock} color="text-green-600" />
              <StatCard title="Last Week" value={data.stats.lastWeek} icon={CalendarCheck} color="text-blue-600" />
              <StatCard title="Last Month" value={data.stats.lastMonth} icon={CalendarDays} color="text-amber-600" />
              <StatCard title="Last Year" value={data.stats.lastYear} icon={CalendarRange} color="text-rose-600" />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <VisitChart title="Last 24 Hours (by hour)" data={data.series.last24Hours} />
              <VisitChart title="Last 7 Days (by day)" data={data.series.lastWeek} />
              <VisitChart title="Last Month (by day)" data={data.series.lastMonth} />
              <VisitChart title="Last Year (by month)" data={data.series.lastYear} />
              <VisitChart title="All Time" data={data.series.allTime} />
            </section>

            <section>
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">Login History (by Gmail)</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.visits.length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center">No logins recorded yet. Each Google sign-in is logged here.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-4 font-semibold">#</th>
                            <th className="py-2 pr-4 font-semibold">Gmail</th>
                            <th className="py-2 font-semibold">When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.visits.map((v, i) => (
                            <tr key={v.id} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-visit-${v.id}`}>
                              <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                              <td className="py-2 pr-4 font-medium" data-testid={`text-visit-email-${v.id}`}>{v.email || "(no email)"}</td>
                              <td className="py-2" data-testid={`text-visit-time-${v.id}`}>
                                {new Date(v.visitedAt).toLocaleString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
