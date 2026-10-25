import {
  TaxonomyListPage,
  taxonomyMetadata,
} from "../../../../../../components/content/content-pages";

import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return taxonomyMetadata("tag", "en", (await params).slug, await searchParams);
}

export default async function Page({ params, searchParams }: Props) {
  return (
    <TaxonomyListPage
      kind="tag"
      locale="en"
      slug={(await params).slug}
      searchParams={await searchParams}
    />
  );
}
