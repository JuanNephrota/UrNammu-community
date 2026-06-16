export function isDemoModeEnabled() {
  return (
    process.env.DEMO_MODE === "true" ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  );
}

export const DEMO_ADMIN_EMAIL = "admin@example.com";
