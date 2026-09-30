import { buttonClass, PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/run";
import { bookmarkletHref } from "../origin";
import { CaptureForm } from "./capture-form";

// Saving runs createJobAction, which analyzes the posting with Claude.
export const maxDuration = 300;

export const metadata = { title: "Save a posting" };

export default async function CapturePage() {
  const ai = aiConfigured();
  const bookmarklet = await bookmarkletHref();
  return (
    <>
      <PageHeader
        title="Save a posting"
        description="Check what the bookmark picked up from the job page you had open, then save it to your pipeline. This app never visits the job site itself; the posting came from your own browser."
        back={{ href: "/discover", label: "Discover" }}
      />
      <CaptureForm ai={ai} bookmarklet={bookmarklet} buttonClassName={buttonClass("primary")} />
    </>
  );
}
