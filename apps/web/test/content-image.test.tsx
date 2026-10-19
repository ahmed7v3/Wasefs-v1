// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContentImage } from "../src/components/content-image";

import type { ContentImageAsset } from "@wasfa/shared/schemas/media";

const ORIGIN = "https://media.example.test/";
const variant = (format: "avif" | "webp" | "jpeg", width: number) => ({
  format,
  width,
  key: `media/abc/${String(width)}.${format === "jpeg" ? "jpg" : format}`,
  bytes: 1000,
});
const asset: ContentImageAsset = {
  width: 1280,
  height: 720,
  focalX: 30,
  focalY: 70,
  blurDataUrl: "data:image/webp;base64,AAAA",
  variants: [
    variant("jpeg", 640),
    variant("avif", 640),
    variant("webp", 320),
    variant("avif", 320),
    variant("jpeg", 320),
    variant("webp", 640),
  ],
};

describe("ContentImage", () => {
  it("renders avif and webp sources plus a jpeg img with fixed size and the focal point", () => {
    const { container } = render(
      <ContentImage
        asset={asset}
        sizes="(min-width: 768px) 50vw, 100vw"
        alt="وصفة"
        origin={ORIGIN}
      />,
    );
    const sources = [...container.querySelectorAll("source")];
    expect(sources.map((source) => source.getAttribute("type"))).toEqual([
      "image/avif",
      "image/webp",
    ]);
    expect(sources[0]?.getAttribute("srcset")).toBe(
      "https://media.example.test/media/abc/320.avif 320w, https://media.example.test/media/abc/640.avif 640w",
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://media.example.test/media/abc/640.jpg");
    expect(img?.getAttribute("width")).toBe("1280");
    expect(img?.getAttribute("height")).toBe("720");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    expect(img?.getAttribute("alt")).toBe("وصفة");
    expect(img?.style.objectPosition).toBe("30% 70%");
    expect(img?.style.backgroundImage).toContain("data:image/webp;base64,AAAA");
  });

  it("marks an eager image as high priority", () => {
    const { container } = render(
      <ContentImage asset={asset} sizes="100vw" alt="" loading="eager" origin={ORIGIN} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
  });

  it("renders nothing without a media origin or without variants", () => {
    expect(
      render(<ContentImage asset={asset} sizes="100vw" alt="" origin={undefined} />).container
        .innerHTML,
    ).toBe("");
    const empty = { ...asset, variants: [] };
    expect(
      render(<ContentImage asset={empty} sizes="100vw" alt="" origin={ORIGIN} />).container
        .innerHTML,
    ).toBe("");
  });
});
