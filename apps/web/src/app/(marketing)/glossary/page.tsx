import { GlossaryHubPage, glossaryHubMetadata } from "../../../components/content/content-pages";

export function generateMetadata() {
  return glossaryHubMetadata("ar");
}

export default function Page() {
  return <GlossaryHubPage locale="ar" />;
}
