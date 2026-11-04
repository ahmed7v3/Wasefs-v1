"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { useReducedMotion } from "./use-reduced-motion";
import "./early-visual.css";

type Props = {
  /** Fixed pixel size; default is responsive via CSS (240px mobile, 420px desktop). */
  size?: number;
  className?: string;
  /** When set the character is exposed as an image; otherwise it is decorative. */
  label?: string;
};

/** Soft 8-lobed blob (echoes the reference silhouette), smoothed with Catmull-Rom to cubic Beziers. */
function blobPath(cx: number, cy: number, r: number, amp: number, lobes: number): string {
  const n = 48;
  const pt = (i: number): [number, number] => {
    const t = (((i + n) % n) / n) * Math.PI * 2;
    const rr = r + amp * Math.cos(lobes * t);
    return [cx + rr * Math.cos(t), cy + rr * 0.94 * Math.sin(t)];
  };
  const f = (v: number) => v.toFixed(2);
  const [x0, y0] = pt(0);
  let d = `M${f(x0)} ${f(y0)}`;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pt(i - 1);
    const [bx, by] = pt(i);
    const [cx2, cy2] = pt(i + 1);
    const [dx, dy] = pt(i + 2);
    d += `C${f(bx + (cx2 - ax) / 6)} ${f(by + (cy2 - ay) / 6)} ${f(cx2 - (dx - bx) / 6)} ${f(cy2 - (dy - by) / 6)} ${f(cx2)} ${f(cy2)}`;
  }
  return `${d}Z`;
}

const BODY = blobPath(200, 190, 148, 5, 8);
const EYES = [158, 242] as const;
const EYE_Y = 180;
const MAX_X = 13;
const MAX_Y = 18;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function WasfaCharacter({ size, className, label }: Props) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const pupilsRef = useRef<(SVGGElement | null)[]>([]);
  const happyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const root = rootRef.current;
    const tilt = tiltRef.current;
    if (!root || !tilt || reduced) return;

    // Normalized gaze (-1..1) and smoothed current values.
    const s = { px: 0, py: 0, type: "none", last: 0, tx: 0, ty: 0, x: 0, y: 0 };
    let raf = 0;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let inView = true;
    let running = false;

    const onPointer = (e: PointerEvent) => {
      s.px = e.clientX;
      s.py = e.clientY;
      s.type = e.pointerType;
      s.last = performance.now();
    };

    const tick = (now: number) => {
      if (now - s.last > 2000 && s.type !== "mouse" && s.type !== "pen") {
        // No input (or idle touch): eyes wander gently on their own.
        s.tx = Math.sin(now / 1700) * 0.7;
        s.ty = Math.cos(now / 2300) * 0.35;
      } else {
        const r = root.getBoundingClientRect();
        s.tx = clamp((s.px - (r.left + r.width / 2)) / 320, -1, 1);
        s.ty = clamp((s.py - (r.top + r.height / 2)) / 320, -1, 1);
      }
      s.x += (s.tx - s.x) * 0.15;
      s.y += (s.ty - s.y) * 0.15;
      // Keep the pupil inside the elliptical sclera.
      const ox = s.x * MAX_X;
      const oy = s.y * MAX_Y;
      const k = Math.hypot(ox / MAX_X, oy / MAX_Y);
      const sc = k > 1 ? 1 / k : 1;
      const tf = `translate(${(ox * sc).toFixed(2)}px, ${(oy * sc).toFixed(2)}px)`;
      for (const p of pupilsRef.current) if (p) p.style.transform = tf;
      tilt.style.transform = `rotateY(${(s.x * 10).toFixed(2)}deg) rotateX(${(-s.y * 8).toFixed(2)}deg)`;
    };

    const loop = (now: number) => {
      tick(now);
      raf = requestAnimationFrame(loop);
    };

    const blink = () => {
      const el = eyesRef.current;
      if (el && typeof el.animate === "function") {
        const run = () =>
          el.animate(
            [{ transform: "scaleY(1)" }, { transform: "scaleY(0.08)" }, { transform: "scaleY(1)" }],
            { duration: 120, easing: "ease-in-out" },
          );
        run();
        if (Math.random() < 0.2) setTimeout(run, 230);
      }
      blinkTimer = setTimeout(blink, 3000 + Math.random() * 3000);
    };

    const sync = () => {
      const should = inView && !document.hidden;
      if (should && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
        blinkTimer = setTimeout(blink, 3000 + Math.random() * 3000);
      } else if (!should && running) {
        running = false;
        cancelAnimationFrame(raf);
        clearTimeout(blinkTimer);
      }
    };

    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            inView = entries.some((e) => e.isIntersecting);
            sync();
          });
    io?.observe(root);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      io?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reduced]);

  useEffect(() => () => clearTimeout(happyTimer.current), []);

  // CSP forbids inline style attributes; CSSOM writes are allowed.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (size) el.style.inlineSize = `${size}px`;
    else el.style.removeProperty("inline-size");
  }, [size]);

  const beHappy = () => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.happy = "1";
    clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => {
      delete root.dataset.happy;
    }, 1000);
  };

  const g = (name: string) => `url(#${name}-${uid})`;
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);

  return (
    <div
      ref={rootRef}
      className={`ev-char${className ? ` ${className}` : ""}`}
      {...a11y}
    >
      <div className="ev-char-shadow" />
      <div className="ev-char-float">
        <div ref={tiltRef} className="ev-char-tilt">
          <div className="ev-char-squish" onPointerEnter={beHappy} onPointerDown={beHappy}>
            <svg viewBox="0 0 400 400" focusable="false" className="ev-char-svg">
              <defs>
                <radialGradient id={`base-${uid}`} cx="50%" cy="46%" r="62%">
                  <stop offset="0" stopColor="#14285F" />
                  <stop offset="0.55" stopColor="#1E3A8A" />
                  <stop offset="1" stopColor="#2A52B8" />
                </radialGradient>
                <radialGradient id={`rim-${uid}`} cx="50%" cy="50%" r="52%" fx="38%" fy="30%">
                  <stop offset="0.72" stopColor="#60A5FA" stopOpacity="0" />
                  <stop offset="0.93" stopColor="#60A5FA" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#9CC8FF" stopOpacity="0.85" />
                </radialGradient>
                <linearGradient id={`shade-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0.55" stopColor="#0B1220" stopOpacity="0" />
                  <stop offset="1" stopColor="#0B1220" stopOpacity="0.38" />
                </linearGradient>
                <radialGradient id={`sclera-${uid}`} cx="50%" cy="38%" r="70%">
                  <stop offset="0" stopColor="#FFFFFF" />
                  <stop offset="1" stopColor="#DCE8FF" />
                </radialGradient>
                <filter id={`blur-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="9" />
                </filter>
                <filter id={`blur2-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3" />
                </filter>
                <clipPath id={`body-${uid}`}>
                  <path d={BODY} />
                </clipPath>
                {EYES.map((x, i) => (
                  <clipPath key={x} id={`eye${i}-${uid}`}>
                    <ellipse cx={x} cy={EYE_Y} rx="30" ry="38" />
                  </clipPath>
                ))}
              </defs>

              <path d={BODY} fill={g("base")} />
              <g clipPath={g("body")}>
                <path d={BODY} fill={g("rim")} />
                <path d={BODY} fill={g("shade")} />
                {/* inner shadow along the lower edge */}
                <path
                  d={BODY}
                  fill="none"
                  stroke="#0B1220"
                  strokeOpacity="0.35"
                  strokeWidth="22"
                  filter={g("blur")}
                  transform="translate(0 10)"
                />
                {/* specular highlights */}
                <ellipse
                  cx="128"
                  cy="104"
                  rx="46"
                  ry="26"
                  fill="#fff"
                  fillOpacity="0.5"
                  filter={g("blur")}
                  transform="rotate(-32 128 104)"
                />
                <ellipse
                  cx="116"
                  cy="96"
                  rx="15"
                  ry="8"
                  fill="#fff"
                  fillOpacity="0.85"
                  filter={g("blur2")}
                  transform="rotate(-32 116 96)"
                />
              </g>

              <g ref={eyesRef} className="ev-char-eyes">
                {EYES.map((x, i) => (
                  <g key={x}>
                    <ellipse cx={x} cy={EYE_Y} rx="30" ry="38" fill={g("sclera")} />
                    <g clipPath={g(`eye${i}`)}>
                      <g
                        ref={(el) => {
                          pupilsRef.current[i] = el;
                        }}
                        className="ev-char-pupil"
                      >
                        <circle cx={x} cy={EYE_Y + 2} r="15" fill="#0B1220" />
                        <circle cx={x + 5} cy={EYE_Y - 5} r="4.5" fill="#fff" />
                        <circle cx={x - 5} cy={EYE_Y + 8} r="1.8" fill="#fff" fillOpacity="0.7" />
                      </g>
                    </g>
                  </g>
                ))}
              </g>
              <g className="ev-char-arcs" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round">
                {EYES.map((x) => (
                  <path key={x} d={`M${x - 24} ${EYE_Y + 10}Q${x} ${EYE_Y - 30} ${x + 24} ${EYE_Y + 10}`} />
                ))}
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
