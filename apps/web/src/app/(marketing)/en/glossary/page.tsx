import { GlossaryHubPage, glossaryHubMetadata } from "../../../../components/content/content-pages";

export function generateMetadata() {
  return glossaryHubMetadata("en");
}

export default function Page() {
  return <GlossaryHubPage locale="en" />;
}
