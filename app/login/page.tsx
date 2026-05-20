import { fetchPublicBranding } from "@/lib/app-settings-server";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const branding = await fetchPublicBranding();
  return <LoginForm branding={branding} />;
}
