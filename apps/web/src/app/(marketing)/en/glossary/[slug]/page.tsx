import { ItemPage, itemMetadata } from "../../../../../components/content/content-pages";

import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return itemMetadata("glossary", "en", (await params).slug);
}

export default async function Page({ params }: Props) {
  return <ItemPage type="glossary" locale="en" slug={(await params).slug} />;
}
