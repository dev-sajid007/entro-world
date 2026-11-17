import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import type { ZodType } from "zod";
import { loginSchema, registerSchema } from "@entroworld/validation";
import { Button, Card, ErrorText, Field, Input, Spinner } from "../../components/ui";
import { ApiError, api, errorMessage } from "../../lib/api";
import { safeNext, useAuth } from "./AuthContext";
import styles from "./Auth.module.css";

type Fields = Record<string, string>;

/** Client-side validation with the same schemas the API uses; returns per-field messages. */
function validate<T>(schema: ZodType<T>, input: unknown): { data: T | null; fields: Fields } {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data, fields: {} };
  const fields: Fields = {};
  for (const issue of result.error.issues) fields[String(issue.path[0] ?? "_")] ??= issue.message;
  return { data: null, fields };
}

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.logo}>
        EntroWorld
      </Link>
      <Card className={styles.card}>
        <h1>{title}</h1>
        {subtitle && <p className={styles.sub}>{subtitle}</p>}
        {children}
      </Card>
      {footer && <p className={styles.footer}>{footer}</p>}
    </div>
  );
}

export function LoginPage() {
  const { status, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ login: "", password: "" });
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));

  if (status === "authenticated" && !busy) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { data, fields: invalid } = validate(loginSchema, form);
    setFields(invalid);
    setError("");
    if (!data) return;
    setBusy(true);
    try {
      await login(data.login, data.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to return to the city."
      footer={
        <>
          New here? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Email or username" error={fields.login}>
          <Input autoComplete="username" autoFocus value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </Field>
        <Field label="Password" error={fields.password}>
          <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", username: "", displayName: "", password: "" });
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  if (status === "authenticated" && !busy) return <Navigate to="/world" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = { ...form, displayName: form.displayName.trim() || undefined };
    const { data, fields: invalid } = validate(registerSchema, input);
    setFields(invalid);
    setError("");
    if (!data) return;
    setBusy(true);
    try {
      const res = await register(data);
      if (res.verificationRequired) {
        setCheckEmail(data.email);
        setBusy(false);
      } else {
        navigate("/world", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setFields(err.fields);
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (checkEmail) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/login">Back to sign in</Link>}>
        <p className={styles.notice}>
          We sent a confirmation link to <strong>{checkEmail}</strong>. Open it to activate your account, then sign in.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Pick a name people will see around the city."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Email" error={fields.email}>
          <Input type="email" autoComplete="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Username" error={fields.username} hint="Letters, numbers, dots and underscores.">
          <Input autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Display name (optional)" error={fields.displayName}>
          <Input autoComplete="nickname" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Password" error={fields.password} hint="At least 10 characters.">
          <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState("");
  const sent = useRef(false);

  useEffect(() => {
    // Tokens are single use: never send twice (StrictMode runs effects twice in development).
    if (sent.current) return;
    sent.current = true;
    const token = params.get("token");
    if (!token) {
      setState("failed");
      setMessage("This link is missing its token.");
      return;
    }
    api
      .post("/auth/verify-email", { token })
      .then(() => setState("done"))
      .catch((e) => {
        setState("failed");
        setMessage(errorMessage(e));
      });
  }, [params]);

  return (
    <AuthShell title="Email confirmation" footer={<Link to="/login">Go to sign in</Link>}>
      {state === "working" && <Spinner />}
      {state === "done" && <p className={styles.notice}>Your email address is confirmed. You can sign in now.</p>}
      {state === "failed" && <ErrorText>{message}</ErrorText>}
    </AuthShell>
  );
}
