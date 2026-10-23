import { BRAND_ASSETS, brandAssetResponse } from "../../lib/brand-asset";

export async function GET(request: Request): Promise<Response> {
  return brandAssetResponse(request, BRAND_ASSETS.appleTouchIcon);
}
