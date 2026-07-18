import { listGoogleAccounts } from "@/lib/google-accounts";
import { googleConfigured } from "@/lib/google-calendar";
import { CalendarsManager } from "./calendars-manager";

export const dynamic = "force-dynamic";

export default async function CalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const accounts = await listGoogleAccounts();
  return (
    <CalendarsManager
      configured={googleConfigured()}
      initial={accounts}
      connected={connected ?? null}
      error={error ?? null}
    />
  );
}
