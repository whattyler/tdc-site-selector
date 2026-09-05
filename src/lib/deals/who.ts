import { auth } from "@/lib/auth";

/**
 * Who is saving. Spec B4.
 *
 * The dev bypass leaves `auth()` returning null on purpose — it is not a login.
 * Rather than write an empty string into `created_by`, a save made through the
 * bypass is stamped "dev", which is both honest and obvious in the pipeline.
 */
export async function currentActor(): Promise<string> {
  const session = await auth();
  return session?.user?.upn ?? session?.user?.name ?? "dev";
}
