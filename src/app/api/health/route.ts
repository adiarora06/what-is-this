export const runtime = "nodejs";

export async function GET() {
  const backendUrl = process.env.VISION_BACKEND_URL?.replace(/\/$/, "");
  const accuracyProvider = process.env.ACCURACY_PROVIDER || "auto";
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const geminiUsable = geminiConfigured && !["classifier", "cv"].includes(accuracyProvider.toLowerCase());

  if (!backendUrl) {
    return Response.json({
      ok: geminiUsable,
      accuracyProvider,
      geminiConfigured,
      backendConfigured: false,
      error: geminiUsable ? undefined : "GEMINI_API_KEY or VISION_BACKEND_URL is not configured.",
    });
  }

  try {
    const response = await fetch(`${backendUrl}/health`, {
      cache: "no-store",
      headers: process.env.VISION_BACKEND_TOKEN ? { Authorization: `Bearer ${process.env.VISION_BACKEND_TOKEN}` } : undefined,
    });

    if (!response.ok) {
      return Response.json({
        ok: geminiUsable,
        accuracyProvider,
        geminiConfigured,
        backendConfigured: true,
        backendError: `Backend health check failed: ${response.status}`,
        error: geminiUsable ? undefined : `Backend health check failed: ${response.status}`,
      });
    }

    const backend = await response.json();
    return Response.json({
      ok: true,
      accuracyProvider,
      geminiConfigured,
      backendConfigured: true,
      backend: {
        mode: backend.mode,
        yoloModel: backend.yolo_model,
        classifierModel: backend.classifier_model,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend health check failed.";
    return Response.json({
      ok: geminiUsable,
      accuracyProvider,
      geminiConfigured,
      backendConfigured: true,
      backendError: message,
      error: geminiUsable ? undefined : message,
    });
  }
}
