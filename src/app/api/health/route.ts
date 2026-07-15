export const runtime = "nodejs";

export async function GET() {
  const backendUrl = process.env.VISION_BACKEND_URL?.replace(/\/$/, "");

  if (!backendUrl) {
    return Response.json({
      ok: false,
      backendConfigured: false,
      error: "VISION_BACKEND_URL is not configured.",
    });
  }

  try {
    const response = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      headers: process.env.VISION_BACKEND_TOKEN ? { Authorization: `Bearer ${process.env.VISION_BACKEND_TOKEN}` } : undefined,
    });

    if (!response.ok) {
      return Response.json({
        ok: false,
        backendConfigured: true,
        error: `Backend health check failed: ${response.status}`,
      });
    }

    const backend = await response.json();
    return Response.json({
      ok: true,
      backendConfigured: true,
      backend: {
        yoloModel: backend.yolo_model,
        classifierModel: backend.classifier_model,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      backendConfigured: true,
      error: error instanceof Error ? error.message : "Backend health check failed.",
    });
  }
}
