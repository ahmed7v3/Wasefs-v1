import { Container, buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { landing } from "../../content/landing";

const { cta } = landing;

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-12 sm:py-20">
      <Container>
        <div className="rounded-2xl bg-primary-soft px-6 py-10 text-center shadow-raised sm:px-12 sm:py-14">
          <h2
            id="cta-title"
            className="font-heading text-2xl font-semibold text-primary sm:text-3xl"
          >
            {cta.title}
          </h2>
          <p className="mx-auto mt-3 max-w-reading text-lg text-text-muted">{cta.body}</p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <Link href="/register" className={buttonStyles({ size: "lg" })}>
              {cta.primary}
            </Link>
            <Link href="/contact" className={buttonStyles({ size: "lg", variant: "secondary" })}>
              {cta.secondary}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
