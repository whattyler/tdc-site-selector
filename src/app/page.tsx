import { redirect } from "next/navigation";

/**
 * The app root. Spec B8.
 *
 * There is no landing page: the pipeline is what you want when you open this,
 * and a blank deal form is something you ask for. Sending the root here also
 * closes the last way to reach an empty form by accident — before, anyone
 * landing on `/` and pressing Save created a nameless deal in a shared list.
 */
export default function Root() {
  redirect("/pipeline");
}
