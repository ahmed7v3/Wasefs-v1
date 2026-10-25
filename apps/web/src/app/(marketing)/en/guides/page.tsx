import { GuidesHubPage, hubMetadata } from "../../../../components/content/content-pages";

import type { Metadata } from "next";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return hubMetadata("guides", "en", await searchParams);
}

export default async function Page({ searchParams }: Props) {
  return <GuidesHubPage locale="en" searchParams={await searchParams} />;
}
