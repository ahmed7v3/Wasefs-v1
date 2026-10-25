import {
  ItemPage,
  itemMetadata,
  pageSlugFromSegments,
} from "../../../../components/content/content-pages";

import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string[] }>;
}

// Static routes (`/about`, `/pricing`, `/features/*`...) always win over this catch-all. Anything that
// cannot be a `page` slug answers 404 here without calling the API.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return itemMetadata("page", "en", pageSlugFromSegments((await params).slug));
}

export default async function Page({ params }: Props) {
  return <ItemPage type="page" locale="en" slug={pageSlugFromSegments((await params).slug)} />;
}
