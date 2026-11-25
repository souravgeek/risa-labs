import { growthDraft } from "@/lib/growth-actions";
import { input, state, commit, change, uid } from "@/lib/workspace";
import { entries } from "@/lib/storage";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== (request.headers.get("host") || new URL(request.url).host))
      return Response.json({ error: "Origin mismatch." }, { status: 403 });
    const body = await request.json(),
      i = input(body);
    const result = await growthDraft(
      state(await entries(i.season), i),
      i,
      body,
      async (log) => {
        await commit(
          i,
          () => ({
            label: "Generated sponsorship draft",
            entity: body.brandId,
            changes: [change("llm_calls", { id: uid("llm"), ...log })],
          }),
          "Gemini",
        );
      },
    );
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Draft creation failed." },
      { status: 400 },
    );
  }
}
