import { describe, expect, it } from "vitest";

import { createQueryBuilderMock, createSupabaseMock } from "../../test/supabase-query-mock";
import { listActiveMechanics } from "./mechanics";

describe("listActiveMechanics", () => {
  it("queries profiles for active mechanics only, sorted by name", async () => {
    const builder = createQueryBuilderMock({
      data: [
        { id: "m1", full_name: "Anand" },
        { id: "m2", full_name: "Bala" },
      ],
      error: null,
    });
    const supabase = createSupabaseMock(builder);

    const result = await listActiveMechanics(supabase);

    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(builder.eq).toHaveBeenCalledWith("role", "mechanic");
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
    expect(builder.order).toHaveBeenCalledWith("full_name", { ascending: true });
    expect(result).toEqual([
      { id: "m1", fullName: "Anand" },
      { id: "m2", fullName: "Bala" },
    ]);
  });

  it("returns an empty list when the garage has no mechanics yet", async () => {
    const builder = createQueryBuilderMock({ data: [], error: null });
    await expect(listActiveMechanics(createSupabaseMock(builder))).resolves.toEqual([]);
  });

  it("throws the underlying error message", async () => {
    const builder = createQueryBuilderMock({ data: null, error: { message: "permission denied" } });
    await expect(listActiveMechanics(createSupabaseMock(builder))).rejects.toThrow("permission denied");
  });
});
