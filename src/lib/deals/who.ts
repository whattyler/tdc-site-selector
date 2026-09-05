import { auth } from "@/lib/auth";

/**
 * Who is saving. Spec B4.
 *
 * Every route is gated, so a save normally carries a real signed-in identity.
 * "dev" is the fallback for the case where a session somehow reaches a write
 * without one: an obviously wrong name in the pipeline beats an empty string
 * in `created_by`.
 */
export async function currentActor(): Promise<string> {
  const session = await auth();
  return session?.user?.upn ?? session?.user?.name ?? "dev";
}
