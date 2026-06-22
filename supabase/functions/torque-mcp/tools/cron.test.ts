import { assertEquals } from "@std/assert";
import { buildCronPlan } from "./cron.ts";

Deno.test("buildCronPlan — describes the toggle", () => {
  assertEquals(buildCronPlan("purge-deleted-whatsapp-conversations", false), {
    action: "toggle_cron_job",
    jobname: "purge-deleted-whatsapp-conversations",
    enabled: false,
  });
});
