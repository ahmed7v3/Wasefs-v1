/** Container health probe: confirms the Node server answers. Reveals nothing else. */
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
