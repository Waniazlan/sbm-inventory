import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, type User } from "../api";
import { Button, ErrorBox, Field, Heading } from "../components/shared";
import { useApp } from "../hooks";
import { Avatar } from "../components/Avatar";
import "./profile.css";

export function Profile({ updateUser }: { updateUser: (user: User) => void }) {
  const { user, notify } = useApp();
  const [name, setName] = useState(user.name);
  const [profileError, setProfileError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [picture, setPicture] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState("");
  const [savingPicture, setSavingPicture] = useState(false);
  const pictureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!picture) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(picture);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  async function savePicture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!picture) return;
    setSavingPicture(true);
    setPictureError("");
    try {
      const data = new FormData();
      data.append("picture", picture);
      const response = await api.post<User>("/auth/profile/picture", data);
      updateUser(response.data);
      setPicture(null);
      if (pictureInput.current) pictureInput.current.value = "";
      notify("Your profile picture has been updated.");
    } catch (error) {
      setPictureError(errorText(error));
    } finally {
      setSavingPicture(false);
    }
  }

  async function removePicture() {
    setSavingPicture(true);
    setPictureError("");
    try {
      const response = await api.delete<User>("/auth/profile/picture");
      updateUser(response.data);
      setPicture(null);
      if (pictureInput.current) pictureInput.current.value = "";
      notify("Your profile picture has been removed.");
    } catch (error) {
      setPictureError(errorText(error));
    } finally {
      setSavingPicture(false);
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError("");
    setSavingName(true);
    try {
      const response = await api.put<User>("/auth/profile", { name });
      updateUser(response.data);
      setName(response.data.name);
      notify("Your name has been updated.");
    } catch (error) {
      setProfileError(errorText(error));
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPasswordError("");
    if (data.get("password") !== data.get("password_confirmation")) {
      setPasswordError("The password confirmation does not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await api.put("/auth/password", {
        current_password: data.get("current_password"),
        password: data.get("password"),
        password_confirmation: data.get("password_confirmation"),
      });
      form.reset();
      notify("Your password has been changed.");
    } catch (error) {
      setPasswordError(errorText(error));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <>
      <Heading
        title="My profile"
        subtitle="Update your picture, name and password."
      />
      <div className="profile-settings">
        <section className="panel" aria-labelledby="profile-picture-title">
          <div className="panel-title">
            <div>
              <h2 id="profile-picture-title">Profile picture</h2>
              <p>Choose a JPG, PNG or WebP image up to 5 MB.</p>
            </div>
          </div>
          <form onSubmit={savePicture}>
            <fieldset className="form-grid" disabled={savingPicture}>
              {pictureError && (
                <div className="wide">
                  <ErrorBox message={pictureError} />
                </div>
              )}
              <div className="wide profile-picture-preview">
                <Avatar
                  user={preview ? { ...user, avatar_url: preview } : user}
                  className="profile-picture-avatar"
                />
              </div>
              <Field label="Choose profile picture" wide>
                <input
                  ref={pictureInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setPictureError("");
                    if (
                      file &&
                      (!["image/jpeg", "image/png", "image/webp"].includes(
                        file.type,
                      ) ||
                        file.size > 5 * 1024 * 1024)
                    ) {
                      setPictureError(
                        "Choose a JPG, PNG or WebP image up to 5 MB.",
                      );
                      setPicture(null);
                      event.target.value = "";
                      return;
                    }
                    setPicture(file);
                  }}
                />
              </Field>
              <div className="wide actions profile-picture-actions">
                <Button disabled={!picture || savingPicture}>
                  {savingPicture ? "Saving…" : "Save picture"}
                </Button>
                {user.avatar_url && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={removePicture}
                    disabled={savingPicture}
                  >
                    Remove picture
                  </Button>
                )}
              </div>
            </fieldset>
          </form>
        </section>
        <section className="panel" aria-labelledby="profile-details-title">
          <div className="panel-title">
            <div>
              <h2 id="profile-details-title">Profile details</h2>
              <p>{user.email}</p>
            </div>
          </div>
          <form onSubmit={saveName}>
            <fieldset className="form-grid" disabled={savingName}>
              {profileError && (
                <div className="wide">
                  <ErrorBox message={profileError} />
                </div>
              )}
              <Field label="Name" wide>
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={150}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <div className="wide">
                <Button disabled={savingName}>
                  {savingName ? "Saving…" : "Save name"}
                </Button>
              </div>
            </fieldset>
          </form>
        </section>
        <section className="panel" aria-labelledby="profile-password-title">
          <div className="panel-title">
            <div>
              <h2 id="profile-password-title">Change password</h2>
              <p>Use at least 12 characters for your new password.</p>
            </div>
          </div>
          <form onSubmit={savePassword}>
            <fieldset className="form-grid" disabled={savingPassword}>
              {passwordError && (
                <div className="wide">
                  <ErrorBox message={passwordError} />
                </div>
              )}
              <Field label="Current password" wide>
                <input
                  name="current_password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field label="New password" wide>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={200}
                />
              </Field>
              <Field label="Confirm new password" wide>
                <input
                  name="password_confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={200}
                />
              </Field>
              <div className="wide">
                <Button disabled={savingPassword}>
                  {savingPassword ? "Changing…" : "Change password"}
                </Button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}
