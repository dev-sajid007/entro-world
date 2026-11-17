import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  ACCESSORIES,
  ACCESSORY_SLOTS,
  BODY_TYPES,
  BOTTOMS,
  CLOTHING_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  MAX_ACCESSORIES,
  SHOES,
  SKIN_TONES,
  TOPS,
  avatarConfigSchema,
  generateAvatar,
  type CatalogOption,
} from "@entroworld/avatar";
import { LIMITS, type AvatarConfig, type PrivacySetting } from "@entroworld/shared";
import { Button, Card, Empty, ErrorText, Field, Input, Spinner, Textarea, UserAvatar } from "../../components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "../../lib/api";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { AppShell, timeAgo } from "./AppShell";
import { useBlocked, useMyAvatar, useProfile, useSaveAvatar, useSessions, useSocialAction, useUpdateMe } from "./hooks";
import styles from "./Social.module.css";

export default function SettingsPage() {
  return (
    <AppShell wide>
      <h1 className={styles.pageTitle}>Settings</h1>
      <div className={styles.grid}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ProfileForm />
          <Sessions />
          <Blocked />
        </div>
        <AvatarEditor />
      </div>
    </AppShell>
  );
}

const PRIVACY: { id: PrivacySetting; label: string }[] = [
  { id: "public", label: "Public — anyone can see your profile and public posts" },
  { id: "friends", label: "Friends — only friends see your details and posts" },
  { id: "private", label: "Private — only you" },
];

function ProfileForm() {
  const me = useCurrentUser();
  const { setUser } = useAuth();
  const profile = useProfile(me.username);
  const update = useUpdateMe();
  const [form, setForm] = useState<{ displayName: string; bio: string; privacy: PrivacySetting } | null>(null);

  useEffect(() => {
    if (profile.data && !form) setForm({ displayName: profile.data.user.displayName, bio: profile.data.bio, privacy: profile.data.privacy });
  }, [profile.data, form]);

  if (!form) return <Card>{profile.error ? <ErrorText>{errorMessage(profile.error)}</ErrorText> : <Spinner />}</Card>;
  const fields = update.error instanceof ApiError ? update.error.fields : {};

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(form, { onSuccess: (user) => setUser(user) });
  };

  return (
    <Card>
      <form className={styles.composer} onSubmit={submit}>
        <h2 className={styles.sectionTitle}>Profile</h2>
        <Field label="Display name" error={fields.displayName}>
          <Input value={form.displayName} maxLength={LIMITS.displayName.max} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Bio" error={fields.bio} hint={`${form.bio.length}/${LIMITS.bio.max}`}>
          <Textarea value={form.bio} rows={3} maxLength={LIMITS.bio.max} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <Field label="Who can see your profile">
          <select className={styles.select} value={form.privacy} onChange={(e) => setForm({ ...form, privacy: e.target.value as PrivacySetting })}>
            {PRIVACY.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.row}>
          <Link to={`/u/${me.username}`}>View profile</Link>
          <span className={styles.spacer} />
          {update.isSuccess && <span className={styles.muted}>Saved</span>}
          {update.error && !Object.keys(fields).length && <ErrorText>{errorMessage(update.error)}</ErrorText>}
          <Button type="submit" disabled={update.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: readonly string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          className={`${styles.swatch} ${c === value ? styles.swatchOn : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function Chips({ options, value, onChange, label }: { options: readonly CatalogOption[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className={styles.chips} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={o.id === value} className={`${styles.chip} ${o.id === value ? styles.chipOn : ""}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AvatarEditor() {
  const me = useCurrentUser();
  const saved = useMyAvatar();
  const save = useSaveAvatar();
  const [draft, setDraft] = useState<AvatarConfig | null>(null);

  useEffect(() => {
    if (saved.data && !draft) setDraft(saved.data);
  }, [saved.data, draft]);

  if (!draft) return <Card>{saved.error ? <ErrorText>{errorMessage(saved.error)}</ErrorText> : <Spinner />}</Card>;

  const set = (patch: { appearance?: Partial<AvatarConfig["appearance"]>; clothing?: Partial<AvatarConfig["clothing"]> }) =>
    setDraft({ ...draft, appearance: { ...draft.appearance, ...patch.appearance }, clothing: { ...draft.clothing, ...patch.clothing } });

  const toggleAccessory = (id: string) => {
    if (draft.accessories.includes(id)) return setDraft({ ...draft, accessories: draft.accessories.filter((a) => a !== id) });
    // One accessory per slot: picking a hat replaces the current hat.
    const kept = draft.accessories.filter((a) => ACCESSORY_SLOTS[a] !== ACCESSORY_SLOTS[id]);
    if (kept.length >= MAX_ACCESSORIES) return;
    setDraft({ ...draft, accessories: [...kept, id] });
  };

  const valid = avatarConfigSchema.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.data);

  return (
    <Card>
      <div className={styles.composer}>
        <div className={styles.row}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
            Avatar
          </h2>
          <span className={styles.spacer} />
          <Button variant="ghost" size="small" onClick={() => setDraft(generateAvatar(`${me.username}-${Date.now()}`))}>
            Randomize
          </Button>
        </div>
        <span className={styles.muted}>Changes appear in the city as soon as you save, even if you're already there.</span>
        <Field label="Body">
          <Chips label="Body type" options={BODY_TYPES} value={draft.appearance.bodyType} onChange={(bodyType) => set({ appearance: { bodyType } })} />
        </Field>
        <Field label="Skin tone">
          <Swatches label="Skin tone" colors={SKIN_TONES} value={draft.appearance.skinTone} onChange={(skinTone) => set({ appearance: { skinTone } })} />
        </Field>
        <Field label="Hair">
          <Chips label="Hair style" options={HAIR_STYLES} value={draft.appearance.hairStyle} onChange={(hairStyle) => set({ appearance: { hairStyle } })} />
        </Field>
        <Swatches label="Hair color" colors={HAIR_COLORS} value={draft.appearance.hairColor} onChange={(hairColor) => set({ appearance: { hairColor } })} />
        <Field label="Top">
          <Chips label="Top" options={TOPS} value={draft.clothing.top} onChange={(top) => set({ clothing: { top } })} />
        </Field>
        <Swatches label="Top color" colors={CLOTHING_COLORS} value={draft.clothing.topColor} onChange={(topColor) => set({ clothing: { topColor } })} />
        <Field label="Bottom">
          <Chips label="Bottom" options={BOTTOMS} value={draft.clothing.bottom} onChange={(bottom) => set({ clothing: { bottom } })} />
        </Field>
        <Swatches label="Bottom color" colors={CLOTHING_COLORS} value={draft.clothing.bottomColor} onChange={(bottomColor) => set({ clothing: { bottomColor } })} />
        <Field label="Shoes">
          <Chips label="Shoes" options={SHOES} value={draft.clothing.shoes} onChange={(shoes) => set({ clothing: { shoes } })} />
        </Field>
        <Swatches label="Shoe color" colors={CLOTHING_COLORS} value={draft.clothing.shoesColor} onChange={(shoesColor) => set({ clothing: { shoesColor } })} />
        <Field label={`Accessories (up to ${MAX_ACCESSORIES})`}>
          <div className={styles.chips}>
            {ACCESSORIES.map((a) => (
              <button key={a.id} aria-pressed={draft.accessories.includes(a.id)} className={`${styles.chip} ${draft.accessories.includes(a.id) ? styles.chipOn : ""}`} onClick={() => toggleAccessory(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        </Field>
        <div className={styles.row}>
          {!valid.success && <ErrorText>{valid.error.issues[0]?.message}</ErrorText>}
          {save.error && <ErrorText>{errorMessage(save.error)}</ErrorText>}
          {save.isSuccess && !dirty && <span className={styles.muted}>Saved</span>}
          <span className={styles.spacer} />
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved.data ?? draft)}>
            Reset
          </Button>
          <Button disabled={!dirty || !valid.success || save.isPending} onClick={() => valid.success && save.mutate(valid.data)}>
            Save avatar
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Sessions() {
  const sessions = useSessions();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      await client.invalidateQueries({ queryKey: ["me", "sessions"] });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <h2 className={styles.sectionTitle}>Signed-in devices</h2>
      {sessions.isLoading && <Spinner />}
      <div className={styles.list}>
        {sessions.data?.map((s) => (
          <div key={s.id} className={styles.person}>
            <div className={styles.postMeta}>
              <span className={styles.name}>{describeAgent(s.userAgent)}</span>
              <span className={styles.muted}>
                {s.current ? "This device" : `Last active ${timeAgo(s.lastUsedAt)}`} · signed in {timeAgo(s.createdAt)}
              </span>
            </div>
            {!s.current && (
              <Button size="small" variant="ghost" disabled={busy === s.id} onClick={() => void revoke(s.id)}>
                Sign out
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Blocked() {
  const blocked = useBlocked();
  const action = useSocialAction();
  return (
    <Card>
      <h2 className={styles.sectionTitle}>Blocked people</h2>
      {blocked.isLoading && <Spinner />}
      {blocked.data?.length === 0 && <Empty>You haven't blocked anyone.</Empty>}
      <div className={styles.list}>
        {blocked.data?.map((u) => (
          <div key={u.id} className={styles.person}>
            <UserAvatar name={u.displayName} url={u.avatarUrl} />
            <div className={styles.postMeta}>
              <span className={styles.name}>{u.displayName}</span>
              <span className={styles.muted}>@{u.username}</span>
            </div>
            <Button size="small" variant="ghost" onClick={() => action.mutate({ method: "DELETE", path: `/users/${u.id}/block` })}>
              Unblock
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
