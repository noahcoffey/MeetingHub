import { getDriveStatus } from "@/lib/drive";
import { DriveManager } from "./drive-manager";

export const dynamic = "force-dynamic";

export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const status = await getDriveStatus();
  return (
    <DriveManager
      configured={status.configured}
      account={status.connected}
      connected={connected ?? null}
      error={error ?? null}
    />
  );
}
