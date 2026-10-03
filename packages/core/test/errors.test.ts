import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { formatUserError, recordNumberSchema } from "@mirror/core";

describe("formatUserError", () => {
  it("joins ZodError issue messages without JSON", () => {
    const parsed = recordNumberSchema.safeParse("!!!bad");
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const text = formatUserError(parsed.error);
    expect(text).toBe("Некорректный номер");
    expect(text).not.toContain("invalid_string");
    expect(text).not.toContain("[");
  });

  it("recovers when Error.message is a Zod issues JSON dump", () => {
    const dump = JSON.stringify([
      {
        validation: "regex",
        code: "invalid_string",
        message: "Некорректный номер",
        path: ["number"],
      },
    ]);
    expect(formatUserError(new Error(dump))).toBe("Некорректный номер");
  });

  it("keeps ordinary Error messages", () => {
    expect(formatUserError(new Error("Формат срока оплаты: 30m, 24h или 14d"))).toBe(
      "Формат срока оплаты: 30m, 24h или 14d",
    );
  });

  it("uses fallback for unknown values", () => {
    expect(formatUserError(null)).toBe("Неизвестная ошибка");
    expect(formatUserError(42, "Некорректные детали")).toBe("Некорректные детали");
  });

  it("dedupes repeated Zod messages", () => {
    const schema = z.object({
      a: z.string().regex(/^x$/, "Плохо"),
      b: z.string().regex(/^x$/, "Плохо"),
    });
    try {
      schema.parse({ a: "1", b: "2" });
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect(formatUserError(error)).toBe("Плохо");
    }
  });
});
