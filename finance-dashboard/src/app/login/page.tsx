import { authConfigured } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="login">
      <div className="card" style={{ width: "100%", maxWidth: 380 }}>
        <div className="brand" style={{ padding: "0 0 14px", color: "var(--ink)" }}>
          <span className="brand-mark" style={{ color: "#fff" }} aria-hidden>T</span>
          Thrive Finance
        </div>
        {authConfigured() ? (
          <LoginForm />
        ) : (
          <div className="banner err" style={{ margin: 0 }}>
            Set <code>APP_PASSWORD</code> and <code>APP_SECRET</code> (32+ characters) in <code>.env</code>, then restart the server.
          </div>
        )}
      </div>
    </div>
  );
}
