import "./early-visual.css";

/** Soft navy-to-blue glow plus a faint dot grid that fades at the edges. Fills its (relative) parent. */
export function HaloBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`ev-halo${className ? ` ${className}` : ""}`}>
      <div className="ev-halo-glow" />
      <div className="ev-halo-glow ev-halo-glow-core" />
      <div className="ev-halo-grid" />
    </div>
  );
}
