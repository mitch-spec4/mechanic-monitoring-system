import { mark } from "../i18n";
import type { User } from "../services/api";
import type { Feature } from "../services/types";

// What each feature is called, and the first plan that includes it (as backend/app/services/plans.py).
export const FEATURES: Record<Feature, { name: string; plan: string }> = {
  insights: { name: mark("Insights and exports"), plan: "Professional" },
  maintenance: { name: mark("Planned maintenance and reminders"), plan: "Professional" },
  routes: { name: mark("Route planning"), plan: "Business" },
  costing: { name: mark("Job costing and margins"), plan: "Business" },
};

/** Whether the company's plan includes a feature. A profile saved before plans had features says
 *  yes: the server checks anyway, and the next sign-in brings the list. */
export function can(user: User | null | undefined, feature: Feature) {
  return !user?.features || user.features.includes(feature);
}
