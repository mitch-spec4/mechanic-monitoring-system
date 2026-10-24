import { useEffect, useState } from "react";
import { verifyEmail, type User } from "../services/api";
import { go } from "../lib/route";
import { errorMessage } from "../lib/format";
import { t } from "../i18n";

type Props = { token: string; user: User | null; onVerified: (user: User) => void };

/** The link in a verification email. It works signed in or not: the link itself is the proof. */
export default function VerifyEmail({ token, user, onVerified }: Props) {
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    verifyEmail(token)
      .then((result) => {
        setState("done");
        if (user && result.email === user.email) onVerified({ ...user, email_verified: true });
      })
      .catch((problem) => {
        setError(errorMessage(problem));
        setState("failed");
      });
  }, [token]);

  return (
    <main className="login">
      <section className="loginCard" aria-live="polite">
        <div className="brand">
          🔧 <span>MECHANIC</span>PRO
        </div>
        {state === "working" && <h1>{t("Confirming your email…")}</h1>}
        {state === "done" && (
          <>
            <h1>{t("Email confirmed")}</h1>
            <div className="success" role="status">
              {t("Thanks. You can now invite your team and customers.")}
            </div>
          </>
        )}
        {state === "failed" && (
          <>
            <h1>{t("That link didn't work")}</h1>
            <div className="error" role="alert">
              {error}
            </div>
          </>
        )}
        {state !== "working" && (
          <button className="primary" onClick={() => go(user ? "/" : "/signin")}>
            {user ? t("Go to your dashboard") : t("Sign in")}
          </button>
        )}
      </section>
    </main>
  );
}
